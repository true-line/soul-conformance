//go:build darwin

// Loaded only into the pinned Machine's members tests. Build reads the real
// release-format fixture and plans both runtime-directory states on a fake host.
package members

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRenderPairedHQRepairPlans(t *testing.T) {
	base := t.TempDir()
	h := emptyHost()
	role := DarwinHQAccount
	home := HQHome(PlatformDarwin, role)
	h.accounts["operator"] = Account{Name: "operator", UID: 501}
	h.accounts[role] = Account{
		Name: role, UID: 331, GID: 331, Group: role, Home: home, Shell: DarwinNoLoginShell,
		PrimaryUsers: []string{role}, Groups: []string{role}, DarwinRole: darwinHQRoleName,
	}
	h.entries[home] = Entry{Dir: true, Owner: role, Group: role, Mode: 0700}
	release := makeTestHQRelease(t, h, base, launchControlV2, filepath.Join(base, "node"), "// fixture\n")
	input := Input{Platform: PlatformDarwin, HQAccount: role, Invoker: "operator", HQService: release,
		upgradeObservation: &upgradeObservation{acl: func([]string) error { return nil }}}
	for _, tc := range []struct{ name, directoryAction, serviceAction string }{
		{"v2-create", "create", "create"},
		{"v2-reuse", "none", "write"},
	} {
		p, err := Build(input, h)
		if err != nil {
			t.Fatal(err)
		}
		var rec launchRecord
		if err := json.Unmarshal([]byte(p.Steps[1].Content), &rec); err != nil {
			t.Fatal(err)
		}
		want := launchDirectory{
			Path: "/Library/Application Support/ai.true-line.agent-bot-hq", Action: tc.directoryAction,
			Owner: "root", Group: "wheel", Mode: "0755",
		}
		if p.Steps[1].Action != tc.serviceAction || rec.RuntimeDir == nil || *rec.RuntimeDir != want {
			t.Fatalf("%s: unexpected planned service or directory", tc.name)
		}
		canonical, err := p.Canonical()
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(os.Getenv("RECOVERY_PLANS"), tc.name+".json"), canonical, 0600); err != nil {
			t.Fatal(err)
		}
		// The second plan reviews an existing matching plist and product directory.
		h.entries[launchRuntimeDir] = Entry{Dir: true, Owner: "root", Group: "wheel", Mode: 0755}
		h.entries[launchPlist] = Entry{Regular: true, Owner: "root", Group: "wheel", Mode: 0644}
		h.files[launchPlist] = rec.Plist
	}
}
