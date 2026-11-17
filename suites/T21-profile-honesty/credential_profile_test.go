package profile_test

import (
	"net/http"
	"testing"

	"github.com/true-line/agent-bot/e2e"
)

// The subject supplies a loopback server with its production device routes.
// Upstream credential issuance and enrollment use disposable test fixtures.
func TestCooperativeCredentialProfile(t *testing.T) {
	t.Setenv("AGENT_BOT_TEST_GITHUB_API_URL", "")
	t.Setenv("BROWSER_SRV_ADDR", "127.0.0.1:0")
	host := e2e.New(t)
	key := host.ServerKey()
	daemon := host.Enroll(host.EnrollToken())

	check := func(response e2e.Resp, status int) {
		t.Helper()
		if response.Code != status || response.Header.Get("Agent-Bot-Contract") != "credential/v1" {
			t.Fatalf("unexpected contract or status %d, want credential/v1 and %d", response.Code, status)
		}
		if response.JTI == "" || !response.Verifies(key, response.JTI) {
			t.Fatal("response is not signed for this request")
		}
	}

	const op = "t21-profile"
	const repo = "true-line/agent-bot"
	refusal := daemon.Mint("t21", op, repo, map[string]any{"profile": "managed protected"})
	check(refusal, http.StatusForbidden)
	if refusal.Body["error"] != "profile_insufficient" || host.GH.Mints() != 0 {
		t.Fatal("protected claim must be refused with profile_insufficient before issuance")
	}
	before := daemon.Call("GET", "/api/daemon/issuances/"+op, nil)
	check(before, http.StatusOK)
	if before.Body["state"] != "none" || before.Body["issuance_id"] != nil {
		t.Fatal("the refused operation created an issuance")
	}

	issued := daemon.Mint("t21", op, repo, map[string]any{"profile": "managed cooperative"})
	check(issued, http.StatusCreated)
	id, ok := issued.Body["issuance_id"].(string)
	if !ok || id == "" || issued.Body["profile"] != "managed cooperative" || host.GH.Mints() != 1 {
		t.Fatal("expected one cooperative issuance")
	}
	record := daemon.Call("GET", "/api/daemon/issuances?id="+id, nil)
	check(record, http.StatusOK)
	if record.Body["operation_id"] != op || record.Body["profile"] != "managed cooperative" {
		t.Fatal("stored issuance does not identify the operation and its cooperative profile")
	}
}
