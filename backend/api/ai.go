// AI proxy endpoints. The browser cannot call OpenAI-compatible APIs directly
// (CORS + leaking the API key), so the frontend streams through the backend:
// it POSTs the configured endpoint + messages here and we forward the request,
// streaming the upstream SSE response back unchanged.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path/filepath"
	"strings"
	"time"
)

type aiChatRequest struct {
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
	Messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
}

type aiTestRequest struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

// normalizeAIBaseURL trims whitespace, trailing slashes and a trailing
// "/v1" path segment so both "https://api.openai.com/v1" and
// "https://api.openai.com" resolve to the same upstream base.
func normalizeAIBaseURL(raw string) string {
	base := strings.TrimSpace(raw)
	for strings.HasSuffix(base, "/") {
		base = base[:len(base)-1]
	}
	if lower := strings.ToLower(base); strings.HasSuffix(lower, "/v1") {
		base = base[:len(base)-3]
	}
	return base
}

// aiChat forwards a streaming chat/completions request to the configured
// OpenAI-compatible endpoint and relays the SSE bytes to the client.
func (h *Handler) aiChat(w http.ResponseWriter, r *http.Request) {
	var in aiChatRequest
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	base := normalizeAIBaseURL(in.BaseURL)
	if base == "" || in.Model == "" {
		writeError(w, http.StatusBadRequest, errors.New("baseUrl and model are required"))
		return
	}
	if len(in.Messages) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("messages are required"))
		return
	}

	upstream := base + "/v1/chat/completions"
	payload, err := json.Marshal(map[string]any{
		"model":    in.Model,
		"stream":   true,
		"messages": in.Messages,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstream, bytes.NewReader(payload))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if in.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+in.APIKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("ai upstream request: %w", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		writeError(w, resp.StatusCode, fmt.Errorf("ai upstream %s: %s", resp.Status, strings.TrimSpace(string(body))))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			return
		}
	}
}

// aiTest verifies connectivity + auth against the configured endpoint. It
// probes GET /v1/models (instant, no tokens); if that route is unsupported
// it falls back to a minimal 1-token chat completion.
func (h *Handler) aiTest(w http.ResponseWriter, r *http.Request) {
	var in aiTestRequest
	if err := decodeBody(r, &in); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	base := normalizeAIBaseURL(in.BaseURL)
	if base == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "baseUrl is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	modelsReq, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v1/models", nil)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if in.APIKey != "" {
		modelsReq.Header.Set("Authorization", "Bearer "+in.APIKey)
	}
	resp, err := http.DefaultClient.Do(modelsReq)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":    false,
			"error": fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body))),
		})
		return
	}

	// Fall back to a tiny chat completion probe.
	if in.Model == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "model not found and no model configured"})
		return
	}
	probeBody, err := json.Marshal(map[string]any{
		"model":      in.Model,
		"stream":     false,
		"max_tokens": 1,
		"messages":   []map[string]string{{"role": "user", "content": "ping"}},
	})
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	chatReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/chat/completions", bytes.NewReader(probeBody))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	chatReq.Header.Set("Content-Type", "application/json")
	if in.APIKey != "" {
		chatReq.Header.Set("Authorization", "Bearer "+in.APIKey)
	}
	chatResp, err := http.DefaultClient.Do(chatReq)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer chatResp.Body.Close()

	if chatResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(chatResp.Body, 2048))
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":    false,
			"error": fmt.Sprintf("HTTP %d: %s", chatResp.StatusCode, strings.TrimSpace(string(body))),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// maxAudioBytes caps a voice memo upload: OpenAI's transcription API takes up
// to 25 MB per file.
const maxAudioBytes = 25 << 20

var quoteEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`)

// aiTranscribe turns a recorded voice memo into text through the configured
// OpenAI-compatible speech-to-text endpoint (POST /v1/audio/transcriptions,
// served by OpenAI, Groq, LocalAI, speaches, …). Multipart fields: file,
// baseUrl, apiKey, model. Responds {"text": "..."}.
func (h *Handler) aiTranscribe(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAudioBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid upload: %w", err))
		return
	}
	defer r.MultipartForm.RemoveAll()
	base := normalizeAIBaseURL(r.FormValue("baseUrl"))
	model := strings.TrimSpace(r.FormValue("model"))
	if base == "" || model == "" {
		writeError(w, http.StatusBadRequest, errors.New("baseUrl and model are required"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("missing file: %w", err))
		return
	}
	defer file.Close()

	// Re-encode for the upstream API. Keep the file name: OpenAI infers the
	// audio format from its extension.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("model", model); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	part, err := mw.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {fmt.Sprintf(`form-data; name="file"; filename="%s"`, quoteEscaper.Replace(filepath.Base(header.Filename)))},
		"Content-Type":        {contentType},
	})
	if err == nil {
		_, err = io.Copy(part, file)
	}
	if err == nil {
		err = mw.Close()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/audio/transcriptions", &body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if key := r.FormValue("apiKey"); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("transcription request: %w", err))
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		msg := upstreamErrorMessage(raw)
		// llama.cpp answers this when the model it has loaded can't take audio
		// (no audio encoder / mmproj); the "model" field doesn't switch models
		// on a single-model server.
		if strings.Contains(strings.ToLower(msg), "does not support audio") {
			msg += " The model loaded on your AI server can't take audio: load one with audio input (llama.cpp: with its mmproj file), or set Settings › AI › Transcription model to such a model if your server switches models by name."
		}
		writeError(w, http.StatusBadGateway, fmt.Errorf("transcription failed (%s): %s", resp.Status, msg))
		return
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		writeError(w, http.StatusBadGateway, errors.New("transcription failed: unexpected response from the AI endpoint"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": strings.TrimSpace(out.Text)})
}

// upstreamErrorMessage extracts {"error":{"message":…}} (OpenAI style) from
// an upstream error body, else returns the body itself, shortened.
func upstreamErrorMessage(raw []byte) string {
	var parsed struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &parsed) == nil && parsed.Error.Message != "" {
		return parsed.Error.Message
	}
	msg := strings.TrimSpace(string(raw))
	if len(msg) > 300 {
		msg = msg[:300] + "…"
	}
	return msg
}
