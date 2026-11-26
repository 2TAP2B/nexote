package serversync

import "testing"

func TestParseServer(t *testing.T) {
	for raw, want := range map[string]string{
		"https://notes.example.com":             "https://notes.example.com",
		"  HTTPS://Notes.Example.com/pair?x=1 ": "https://notes.example.com",
		"notes.example.com":                     "https://notes.example.com",
		"notes.example.com:8443/sub":            "https://notes.example.com:8443",
		"http://localhost:3000/anything":        "http://localhost:3000",
		"http://127.0.0.1:8080":                 "http://127.0.0.1:8080",
		"http://[::1]:8080":                     "http://[::1]:8080",
	} {
		got, err := ParseServer(raw)
		if err != nil {
			t.Errorf("ParseServer(%q): %v", raw, err)
			continue
		}
		if got.String() != want {
			t.Errorf("ParseServer(%q) = %s, want %s", raw, got, want)
		}
	}
	for _, raw := range []string{
		"",
		"http://notes.example.com",
		"http://192.168.1.10:3000",
		"http://127.0.0.2",
		"http://localhost.example.com",
		"ftp://notes.example.com",
		"https://",
		"https://host:port",
		"mailto:me@example.com",
	} {
		if got, err := ParseServer(raw); err == nil {
			t.Errorf("ParseServer(%q) = %s, want an error", raw, got)
		}
	}
}

func TestParseLink(t *testing.T) {
	server, code, err := ParseLink("https://notes.example.com/pair#abcd-efgh-jkmn-pqrs")
	if err != nil || server.String() != "https://notes.example.com" || code != "ABCD-EFGH-JKMN-PQRS" {
		t.Fatalf("ParseLink = %v, %q, %v", server, code, err)
	}
	// Look-alike letters count as digits; dashes and spaces don't matter.
	if _, code, err := ParseLink("http://localhost:3000/pair#IL0O 1234-5678 9ABC"); err != nil || code != "1100-1234-5678-9ABC" {
		t.Fatalf("ParseLink with look-alikes = %q, %v", code, err)
	}
	for _, raw := range []string{
		"https://notes.example.com/pair",
		"https://notes.example.com/pair#",
		"https://notes.example.com/pair#ABCD-EFGH-JKMN-PQR",
		"https://notes.example.com/pair#ABCD-EFGH-JKMN-PQRST",
		"https://notes.example.com/pair#ABCD-EFGH-JKMN-PQRU",
		"http://notes.example.com/pair#ABCD-EFGH-JKMN-PQRS",
		"ABCD-EFGH-JKMN-PQRS",
	} {
		if _, _, err := ParseLink(raw); err == nil {
			t.Errorf("ParseLink(%q) succeeded", raw)
		}
	}
}
