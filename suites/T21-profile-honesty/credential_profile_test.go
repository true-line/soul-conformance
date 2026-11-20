package profile_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"net/http"
	"net/url"
	"testing"

	"github.com/true-line/agent-bot/e2e"
	"github.com/true-line/agent-bot/pkg/device"
)

// Exercise the production device routes on loopback. Each credential kind is
// available under the cooperative profile in the same disposable tenant.
func TestCooperativeCredentialProfile(t *testing.T) {
	t.Setenv("AGENT_BOT_TEST_GITHUB_API_URL", "")
	t.Setenv("BROWSER_SRV_ADDR", "127.0.0.1:0")
	t.Setenv("VERCEL_ENV", "")
	t.Setenv("SOUL_SIGNING_KEY", "")
	t.Setenv("SOUL_SIGNING_KEY_PREVIOUS", "")
	host := e2e.New(t)
	soulKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	host.Dev.Soul = &device.SoulKeys{Issuer: device.DefaultSoulIssuer, Current: device.NewSoulKey(soulKey)}
	if err := host.Apps.For(e2e.UID).SetProviderKey(t.Context(), e2e.Login, "t21", "test-only-provider-value"); err != nil {
		t.Fatal(err)
	}
	key := host.ServerKey()
	daemon := host.Enroll(host.EnrollToken())

	check := func(t *testing.T, response e2e.Resp, status int) {
		t.Helper()
		if response.Code != status || response.Header.Get("Agent-Bot-Contract") != "credential/v1" {
			t.Fatalf("unexpected contract or status %d, want credential/v1 and %d", response.Code, status)
		}
		if response.JTI == "" || response.Header.Get("Agent-Bot-Request-JTI") != response.JTI || !response.Verifies(key, response.JTI) {
			t.Fatal("response is not signed for this request")
		}
	}

	for _, tc := range []struct {
		kind   string
		status int
		issue  func(op, profile string) e2e.Resp
	}{
		{"installation-token", http.StatusCreated, func(op, profile string) e2e.Resp {
			return daemon.Mint("t21", op, "true-line/agent-bot", map[string]any{"profile": profile})
		}},
		{"provider-key", http.StatusOK, func(op, profile string) e2e.Resp {
			query := url.Values{"provider": {"t21"}, "operation_id": {op}, "profile": {profile}}
			return daemon.Call("GET", "/api/daemon/provider-key?"+query.Encode(), nil)
		}},
		{"soul-token", http.StatusCreated, func(op, profile string) e2e.Resp {
			return daemon.Call("POST", "/api/daemon/soul-token", map[string]any{
				"agent_id": "t21-soul", "account": "t21-account", "task_id": "t21", "operation_id": op, "profile": profile,
			})
		}},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			op := "t21-" + tc.kind
			mints := host.GH.Mints()
			refusal := tc.issue(op, "managed protected")
			check(t, refusal, http.StatusForbidden)
			if refusal.Body["error"] != "profile_insufficient" || host.GH.Mints() != mints {
				t.Fatal("protected claim must be refused with profile_insufficient before issuance")
			}
			before := daemon.Call("GET", "/api/daemon/issuances/"+op, nil)
			check(t, before, http.StatusOK)
			if before.Body["operation_id"] != op || before.Body["state"] != "none" || before.Body["issuance_id"] != nil {
				t.Fatal("the refused operation created an issuance")
			}
			issued := tc.issue(op, "managed cooperative")
			check(t, issued, tc.status)
			id, ok := issued.Body["issuance_id"].(string)
			if !ok || id == "" || issued.Body["operation_id"] != op || issued.Body["profile"] != "managed cooperative" {
				t.Fatal("expected a cooperative issuance")
			}
			record := daemon.Call("GET", "/api/daemon/issuances?id="+id, nil)
			check(t, record, http.StatusOK)
			if record.Body["operation_id"] != op || record.Body["profile"] != "managed cooperative" {
				t.Fatal("stored issuance does not identify the operation and its cooperative profile")
			}
		})
	}
	if host.GH.Mints() != 1 {
		t.Fatal("expected exactly one upstream installation-token mint")
	}
}
