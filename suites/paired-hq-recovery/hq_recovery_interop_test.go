//go:build darwin

// Loaded into the immutable Machine checkout by go test -overlay.
package daemon

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/qwts/managed-machine/internal/members"
	"github.com/qwts/managed-machine/internal/statedir"
)

func TestPairedHQRecoveryInterop(t *testing.T) {
	f := newRecoveryFixture(t)
	// Darwin bounds the length of a Unix socket name.
	work, err := os.MkdirTemp("/private/tmp", "hq-recovery-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(work) })
	write := func(path string, data []byte) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	hqHome := filepath.Join(work, "role")
	roleKeys := filepath.Join(hqHome, ".config", "agent-machine")
	write(filepath.Join(roleKeys, "client.pub"), f.client.Public().(ed25519.PublicKey))
	write(filepath.Join(roleKeys, "client.key"), f.client.Seed())
	write(filepath.Join(work, "fixture-owner.key"), f.owner.D.FillBytes(make([]byte, 32)))

	const planID = "plan-20261119T020000Z-abcd"
	suite := os.Getenv("RECOVERY_SUITE")
	fixture, err := os.ReadFile(filepath.Join(suite, "plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	saved := members.Saved{PlanID: planID}
	if err := json.Unmarshal(fixture, &saved.Plan); err != nil {
		t.Fatal(err)
	}
	var record struct{ Service members.HQService }
	if err := json.Unmarshal([]byte(saved.Plan.Steps[1].Content), &record); err != nil {
		t.Fatal(err)
	}
	saved.HQService = &record.Service
	saved.PlanDigest, err = saved.Plan.Digest()
	if err != nil {
		t.Fatal(err)
	}
	serialized, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	adminHome := filepath.Join(work, "admin")
	state, err := statedir.Path("darwin", func(k string) string {
		if k == "HOME" {
			return adminHome
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(state, "members", "plans", planID+".json"), serialized)

	// Host inspection and launchd are tested by Machine. Here the fixed plan
	// models an already paired, stopped service, without probing any host role.
	f.check = func(id, digest string, uid int) (string, error) {
		if uid != 331 || digest != saved.PlanDigest {
			return "", errRecoveryPlan
		}
		_, canonical, err := decodeSavedMembersPlan(id, serialized)
		return string(canonical), err
	}
	hooks := Hooks{
		MembersPlans:    func(op, id string) ([]byte, error) { return readMembersPlans(adminHome, op, id) },
		ServiceRecovery: f.hook,
	}
	socket := filepath.Join(work, "machine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	rolePeer := func(c net.Conn) (int, error) {
		uid, err := peerCred(c)
		if err != nil || uid != os.Getuid() {
			return -1, errRecoveryPlan
		}
		return 331, nil // Synthetic dedicated role for a checked local peer.
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, listener, &f.gate, f.signer, rolePeer, hooks) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	approvalPath := members.ApprovalPath(f.dir, planID)
	cmd := exec.CommandContext(t.Context(), "node", filepath.Join(suite, "flow.mjs"),
		work, hqHome, socket, hex.EncodeToString(f.machine), planID, saved.PlanDigest, approvalPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("HQ and Identity handoff failed: %v\n%s", err, out)
	}
	raw, err := os.ReadFile(approvalPath)
	if err != nil {
		t.Fatal(err)
	}
	var receipt members.Approval
	if err := json.Unmarshal(raw, &receipt); err != nil || receipt.PlanID != planID || receipt.PlanDigest != saved.PlanDigest {
		t.Fatal("stored Machine approval does not match the reviewed plan")
	}
}
