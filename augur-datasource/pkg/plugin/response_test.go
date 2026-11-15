package plugin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func upstreamWith(t *testing.T, status int, contentType, body string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// A 2xx that isn't a model response must reach the app as an error it can show, never as an
// empty answer (which made the chat look like it silently dropped the message).
func TestUnexpectedUpstreamResponsesBecomeVisibleErrors(t *testing.T) {
	cases := []struct {
		name, ct, body string
		status         int
		wantStatus     int
		wantType, want string
	}{
		{"proxy HTML page", "text/html", "<html><body>Access to this site is blocked by your proxy</body></html>", 200, 502, "invalid_upstream_response", "blocked by your proxy"},
		{"error object with 200", "application/json", `{"error":{"type":"budget_exceeded","message":"Budget has been exceeded for key"}}`, 200, 502, "budget_exceeded", "Budget has been exceeded"},
		{"JSON without content", "application/json", `{"id":"x","type":"message"}`, 200, 502, "invalid_upstream_response", "has no content"},
		{"empty body", "", "", 200, 502, "invalid_upstream_response", "empty body"},
		{"plain-text 500", "text/plain", "upstream connect error or disconnect/reset before headers", 503, 503, "upstream_error", "HTTP 503 from the model endpoint"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ds := newDS(t, upstreamWith(t, c.status, c.ct, c.body), `{"authMethod":"apiKey"}`, map[string]string{"apiKey": "k"})
			s := callMessages(t, ds, minimalBody, nil, nil)
			if s.status != c.wantStatus || errType(t, s.body) != c.wantType || !strings.Contains(string(s.body), c.want) {
				t.Fatalf("status %d body %s", s.status, s.body)
			}
		})
	}
}

func TestValidMessagesResponsesPassThrough(t *testing.T) {
	for _, body := range []string{okReply, `{"id":"m","type":"message","role":"assistant","content":[],"stop_reason":"end_turn"}`} {
		ds := newDS(t, upstreamWith(t, 200, "application/json", body), `{"authMethod":"apiKey"}`, map[string]string{"apiKey": "k"})
		if s := callMessages(t, ds, minimalBody, nil, nil); s.status != 200 || string(s.body) != body {
			t.Fatalf("status %d body %s", s.status, s.body)
		}
	}
	// A structured upstream error keeps its status and body.
	errBody := `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`
	ds := newDS(t, upstreamWith(t, 529, "application/json", errBody), `{"authMethod":"apiKey"}`, map[string]string{"apiKey": "k"})
	if s := callMessages(t, ds, minimalBody, nil, nil); s.status != 529 || string(s.body) != errBody {
		t.Fatalf("status %d body %s", s.status, s.body)
	}
}

func TestOpenAIRefusalIsShown(t *testing.T) {
	status, body := fromOpenAI(200, []byte(`{"id":"c","model":"gpt","choices":[{"finish_reason":"stop","message":{"content":null,"refusal":"I can't help with that."}}]}`))
	if status != 200 || !strings.Contains(string(body), `"text":"I can't help with that."`) || !strings.Contains(string(body), `"stop_reason":"refusal"`) {
		t.Fatalf("status %d body %s", status, body)
	}
}
