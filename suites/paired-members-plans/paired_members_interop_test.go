//go:build darwin

// Loaded by go test -overlay into the pinned Machine daemon test package.
package daemon

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/qwts/managed-machine/internal/cli"
	"github.com/qwts/managed-machine/internal/command"
	"github.com/qwts/managed-machine/internal/members"
	"github.com/qwts/managed-machine/internal/statedir"
	"github.com/qwts/managed-machine/internal/target"
)

type emptyAccounts struct{}

func (emptyAccounts) Account(string) (members.Account, bool, error) {
	return members.Account{}, false, nil
}
func (emptyAccounts) Lstat(string) (members.Entry, bool, error) { return members.Entry{}, false, nil }
func (emptyAccounts) ReadFile(string) (string, bool, error)     { return "", false, nil }
func (emptyAccounts) List(string) ([]string, error)             { return nil, nil }

func TestPairedMembersInterop(t *testing.T) {
	// Darwin's sockaddr_un path limit requires a short base.
	root, err := os.MkdirTemp("/private/tmp", "hq-plan-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	home := filepath.Join(root, "role")
	if err := os.Mkdir(home, 0700); err != nil {
		t.Fatal(err)
	}
	client := func(args ...string) string {
		t.Helper()
		cmd := exec.Command(os.Getenv("HQ_PLAN_NODE"), append([]string{os.Getenv("HQ_PLAN_CLIENT"), home}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("HQ client: %v\n%s", err, out)
		}
		return string(out)
	}
	hq, err := hex.DecodeString(client())
	if err != nil || len(hq) != ed25519.PublicKeySize {
		t.Fatal("expected a fixture HQ identity")
	}
	admin := t.TempDir()
	state, err := statedir.Path("darwin", func(k string) string {
		if k == "HOME" {
			return admin
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(state, "members", "plans")
	ctx := cli.Context{Detect: func() (target.Host, error) { return target.Host{Target: target.DarwinARM64}, nil }}
	var ids []string
	var plans []map[string]string
	original := map[string][]byte{}
	// 65 saved records exercise one full page and its final continuation.
	for i := 0; i < 65; i++ {
		id := fmt.Sprintf("plan-20261118T010000Z-%04x", i)
		ids = append(ids, id)
		deps := members.Deps{
			Deps: command.Deps{
				StateDir:  func() (string, error) { return state, nil },
				Username:  func() (string, error) { return "qa-owner", nil },
				Now:       time.Now,
				NewPlanID: func(time.Time) (string, error) { return id, nil },
			},
			Host: func() members.Host { return emptyAccounts{} },
		}
		args := []string{"plan", "--hq-account", "_agent-bot-hq"}
		if i == 64 {
			args = append(args, "--members", "_qa_harness")
		}
		if result := members.Command(deps).Run(ctx, args); result.Diagnostic != nil {
			t.Fatal(result.Diagnostic)
		}
		path := filepath.Join(dir, id+".json")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if i < 4 || i == 64 {
			var saved members.Saved
			if err := json.Unmarshal(raw, &saved); err != nil {
				t.Fatal(err)
			}
			// The planner emits []; these synthetic HQ-only null records exercise reader compatibility.
			if i == 1 || i == 3 {
				saved.Plan.Members = nil
			}
			if i == 2 || i == 3 {
				saved.Plan.Steps = append(saved.Plan.Steps, members.Step{
					Kind: "service", Target: "ai.true-line.agent-bot-hq", Action: "create", Owner: "qa-owner",
					Content: "<plist>\n<string>QA &amp; test</string>\n</plist>\n",
					Detail:  "Install the QA launchd service",
				})
			}
			canonical, err := saved.Plan.Canonical()
			if err != nil {
				t.Fatal(err)
			}
			saved.PlanDigest, err = saved.Plan.Digest()
			if err != nil {
				t.Fatal(err)
			}
			if i > 0 && i < 4 {
				raw, err = json.Marshal(saved)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			plans = append(plans, map[string]string{"plan_id": id, "plan_digest": saved.PlanDigest, "plan_canonical": string(canonical)})
		}
		original[path] = raw
	}
	for _, pair := range [][2]int{{0, 1}, {2, 3}} {
		if plans[pair[0]]["plan_digest"] == plans[pair[1]]["plan_digest"] {
			t.Fatal("different empty-member representations have the same digest")
		}
	}
	expected, err := json.Marshal(map[string]any{"ids": ids, "plans": plans})
	if err != nil {
		t.Fatal(err)
	}
	expectedFile := filepath.Join(root, "expected.json")
	if err := os.WriteFile(expectedFile, expected, 0600); err != nil {
		t.Fatal(err)
	}
	// Use the subject's account-lookup fixture. Both test processes belong to
	// this user, so supply the simulated HQ UID only after checking the actual peer.
	roleUID := 377
	if os.Getuid() == roleUID {
		roleUID = 376
	}
	testPlanRole(t, fmt.Sprint(roleUID))
	pub, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(root, "machine.sock")
	ln, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	gate := Gate{Pairing: Pairing{Live: hq, AgentDaemon: hq, AgentDaemonBound: true, AgentDaemonUID: roleUID, OwnerPresenceRequired: true}}
	fixturePeer := func(conn net.Conn) (int, error) {
		uid, err := peerCred(conn)
		if err != nil || uid != os.Getuid() {
			return -1, fmt.Errorf("unexpected fixture peer")
		}
		return roleUID, nil
	}
	service, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- Serve(service, ln, &gate, key, fixturePeer, Hooks{
			MembersPlans: func(op, id string) ([]byte, error) { return readMembersPlans(admin, op, id) },
			OnReceipt:    func() { t.Error("read wrote a receipt") },
		})
	}()
	defer func() {
		stop()
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	client(socket, hex.EncodeToString(pub), expectedFile)
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != len(ids) {
		t.Fatal("saved plan directory changed")
	}
	for path, before := range original {
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("lookup changed a saved plan")
		}
	}
}
