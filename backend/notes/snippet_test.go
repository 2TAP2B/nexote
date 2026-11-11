package notes

import "testing"

func TestMakeSnippetStripsMarkdownArtifacts(t *testing.T) {
	cases := []struct {
		name, body, want string
	}{
		{"title heading skipped", "## Title\n\nHello **world**", "Hello world"},
		{"html breaks and entities", "## T\n\na\n\n<br />\n\n&#x20;run dev &amp; more", "a run dev & more"},
		{"escapes kept literal", "## T\n\n\\$ next dev \\#lol \\*x\\*", "$ next dev #lol *x*"},
		{"code fence and math dropped", "## T\n\n```js\nconst a = 1\n```\n$$\nx^2\n$$\nafter", "after"},
		{"tasks lists quotes", "## T\n\n* [ ] todo\n- [x] done\n> quoted\n1. first", "todo done quoted first"},
		{"table", "## T\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |", "a b 1 2"},
		{"links", "## T\n\n[[Page|Alias]] [[Other]] [txt](http://x) ![img](a.png) <https://ex.com>", "Alias Other txt https://ex.com"},
		{"empty heading and rule", "## T\n\n##\n\n---\n\nbody", "body"},
		{"snake_case kept", "## T\n\nuse my_var _em_", "use my_var em"},
	}
	for _, c := range cases {
		if got := makeSnippet(c.body, 150); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestMakeSnippetTruncatesOnRuneBoundary(t *testing.T) {
	if got := makeSnippet("äöüäöü", 3); got != "äöü…" {
		t.Errorf("got %q", got)
	}
}
