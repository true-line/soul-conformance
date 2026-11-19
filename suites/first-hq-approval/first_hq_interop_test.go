//go:build darwin

package daemon

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/qwts/managed-machine/internal/cli"
	"github.com/qwts/managed-machine/internal/members"
)

// The Machine component fixture supplies only the host, clock and temporary
// custodian state. The transfer, native approval transcript and verifier come
// from the two unmodified component checkouts.
func TestFirstHQCrossRepositoryApproval(t *testing.T) {
	for _, state := range []string{"confirmed", "canceled", "expired"} {
		t.Run(state, func(t *testing.T) {
			f := newFirstHQFixture(t)
			call := func(args ...string) cli.Result {
				return f.run(t, args...)
			}
			now := f.deps.Time()
			c := call("export", f.id)
			if c.Diagnostic != nil || len(c.Records) != 1 {
				t.Fatalf("export failed: %v", c.Diagnostic)
			}
			wire, err := c.Records[0].MarshalJSON()
			if err != nil {
				t.Fatal(err)
			}
			var transfer struct {
				Digest  string `json:"plan_digest"`
				Expires int64  `json:"expires_at"`
			}
			if err := json.Unmarshal(wire, &transfer); err != nil {
				t.Fatal(err)
			}

			scalar, err := f.key.Bytes()
			if err != nil {
				t.Fatal(err)
			}
			review := func(at int64) ([]byte, error) {
				t.Helper()
				input := map[string]any{"challenge": json.RawMessage(wire), "key": scalar, "now": at}
				raw, err := json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
				cmd := exec.Command("node", os.Getenv("FIRST_HQ_PREVIEW"))
				cmd.Stdin = bytes.NewReader(raw)
				return cmd.Output()
			}
			checked, err := review(now.Unix())
			if err != nil {
				t.Fatalf("daily-account review and native approval failed: %v", err)
			}
			proofPath := filepath.Join(t.TempDir(), "proof.json")
			if err := os.WriteFile(proofPath, checked, 0600); err != nil {
				t.Fatal(err)
			}
			approval := members.ApprovalPath(stateDir(f.home), f.id)
			checkNoApproval := func() {
				t.Helper()
				if _, err := os.Stat(approval); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("expected an unapplied, unapproved plan")
				}
			}
			checkNoApproval()
			switch state {
			case "canceled":
				if result := call("cancel", f.id); result.Diagnostic != nil {
					t.Fatal(result.Diagnostic.Message)
				}
			case "expired":
				deadline := time.Unix(transfer.Expires, 0)
				f.deps.Now = func() time.Time { return deadline }
				if _, err := review(transfer.Expires); err == nil {
					t.Fatal("Identity accepted an expired transfer")
				}
			}
			submit := func() cli.Result { return call("approve", f.id, "--proof-file", proofPath) }
			result := submit()
			if state != "confirmed" {
				if result.Diagnostic == nil {
					t.Fatalf("Machine accepted a %s proof", state)
				}
				checkNoApproval()
				return
			}
			if result.Diagnostic != nil {
				t.Fatal(result.Diagnostic.Message)
			}
			readApproval := func() []byte {
				t.Helper()
				raw, err := os.ReadFile(approval)
				if err != nil {
					t.Fatal(err)
				}
				return raw
			}
			first := readApproval()
			var saved members.Approval
			if err := json.Unmarshal(first, &saved); err != nil {
				t.Fatal(err)
			}
			if saved.PlanID != f.id || saved.PlanDigest != transfer.Digest {
				t.Fatal("Machine recorded a different plan from the one Identity reviewed")
			}
			if submit().Diagnostic == nil || !bytes.Equal(first, readApproval()) {
				t.Fatal("replaying a consumed proof created or modified an approval")
			}
			// The normal human apply command receives the verified approval. All
			// privileged operations are confined to the in-memory account adapter.
			root := &firstHQRoot{host: f.host}
			d := f.membersDeps
			d.Euid = func() int { return 0 }
			d.ProcessEnv = func() []string { return []string{"SUDO_UID=501"} }
			d.Ancestors = func() []map[string]string { return nil }
			d.LookupUID = func(string) (string, string, error) { return "admin", f.home, nil }
			d.DaemonState = func(owner, home string) (string, string, error) { return stateDir(home), owner, nil }
			d.Root = func() members.Root { return root }
			if f.host.exists {
				t.Fatal("owner approval created a role before apply")
			}
			result = members.Command(d).Run(firstHQContext(), []string{"apply", f.id})
			if result.Diagnostic != nil {
				t.Fatal(result.Diagnostic.Message)
			}
			if !f.host.exists || root.receipt.Result != "applied" || root.receipt.PlanDigest != saved.PlanDigest {
				t.Fatal("expected the synthetic HQ role and an applied receipt matching the reviewed digest")
			}
		})
	}
}
