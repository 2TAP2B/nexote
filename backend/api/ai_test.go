package api

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// transcribeRequest builds the multipart request the quick-notes recorder
// sends; extra adds fields such as the language.
func transcribeRequest(t *testing.T, baseURL string, audio []byte, extra ...[2]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fields := [][2]string{{"baseUrl", baseURL}, {"apiKey", "sk-test"}, {"model", "whisper-1"}}
	for _, f := range append(fields, extra...) {
		if err := mw.WriteField(f[0], f[1]); err != nil {
			t.Fatal(err)
		}
	}
	part, err := mw.CreateFormFile("file", "voice-memo.webm")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(audio); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/transcribe", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestAITranscribeForwardsAudioAndReturnsText(t *testing.T) {
	audio := []byte("\x1aE\xdf\xa3 fake webm/opus bytes")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("upstream path = %q, want /v1/audio/transcriptions", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test" {
			t.Errorf("Authorization = %q", got)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("upstream got a bad multipart body: %v", err)
		}
		if got := r.FormValue("model"); got != "whisper-1" {
			t.Errorf("model = %q", got)
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("upstream got no file: %v", err)
		}
		// The API infers the audio format from the file name.
		if header.Filename != "voice-memo.webm" {
			t.Errorf("file name = %q, want voice-memo.webm", header.Filename)
		}
		data, _ := io.ReadAll(file)
		if !bytes.Equal(data, audio) {
			t.Errorf("audio bytes changed in transit: %q", data)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"  Buy oat milk.\n"}`))
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	// A configured base URL ending in /v1/ must not double the version segment.
	(&Handler{}).aiTranscribe(rec, transcribeRequest(t, upstream.URL+"/v1/", audio))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["text"] != "Buy oat milk." {
		t.Errorf("text = %q, want the trimmed transcript", out["text"])
	}
}

func TestAITranscribeReportsUpstreamError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}`))
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	(&Handler{}).aiTranscribe(rec, transcribeRequest(t, upstream.URL, []byte("x")))

	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Incorrect API key provided") {
		t.Errorf("body %s lacks the upstream message", rec.Body.String())
	}
}

func TestAITranscribeSendsTheLanguageOnlyWhenSet(t *testing.T) {
	for _, tc := range []struct {
		name  string
		extra [][2]string
		want  []string // the upstream's language values; nil = no field
	}{
		{"set", [][2]string{{"language", " de "}}, []string{"de"}},
		// An empty field is an invalid code to some servers: leave it out so
		// the model detects the language.
		{"empty", [][2]string{{"language", ""}}, nil},
		{"absent", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got []string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Fatalf("upstream got a bad multipart body: %v", err)
				}
				got = r.MultipartForm.Value["language"]
				_, _ = w.Write([]byte(`{"text":"Hallo"}`))
			}))
			defer upstream.Close()

			rec := httptest.NewRecorder()
			(&Handler{}).aiTranscribe(rec, transcribeRequest(t, upstream.URL, []byte("x"), tc.extra...))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
			}
			if strings.Join(got, ",") != strings.Join(tc.want, ",") || (got == nil) != (tc.want == nil) {
				t.Errorf("upstream language = %q, want %q", got, tc.want)
			}
		})
	}
}
