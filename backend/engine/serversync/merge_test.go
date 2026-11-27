package serversync

import "testing"

func TestMergeNotepad(t *testing.T) {
	tests := []struct {
		name, server, other, want string
	}{
		{
			name:   "overlapping days and duplicates",
			server: "### 2026-11-24\n- 09:00 a\n- 11:00 b\n\n### 2026-11-26\n- 08:00 c\n",
			other:  "### 2026-11-25\n- 10:00 x\n\n### 2026-11-24\n- 9:00 a\n- 10:30 y\n- 11:00 b\n",
			want:   "### 2026-11-24\n- 09:00 a\n- 10:30 y\n- 11:00 b\n\n### 2026-11-25\n- 10:00 x\n\n### 2026-11-26\n- 08:00 c\n",
		},
		{
			name:   "equal times keep server first",
			server: "### 2026-11-24\n- 09:00 s\n",
			other:  "### 2026-11-24\n- 09:00 o\n- 8:59 early\n",
			want:   "### 2026-11-24\n- 8:59 early\n- 09:00 s\n- 09:00 o\n",
		},
		{
			name:   "pin ignored for duplicates, server version wins",
			server: "### 2026-11-24\n- 09:00 a\n- 10:00 📌 b\n",
			other:  "### 2026-11-24\n- 09:00 📌 a\n- 10:00 b\n- 11:00 📌 c\n",
			want:   "### 2026-11-24\n- 09:00 a\n- 10:00 📌 b\n- 11:00 📌 c\n",
		},
		{
			name:   "star bullets and blank lines between items",
			server: "### 2026-11-24\n\n* 09:00 a\n\n* 10:00 b\n",
			other:  "",
			want:   "### 2026-11-24\n- 09:00 a\n- 10:00 b\n",
		},
		{
			name:   "multi-line items with continuation and images",
			server: "### 2026-11-24\n- 09:00 first\n    deeper\n\n  after blank\n![](img.png)\n- 10:00 pic\n  ![alt](<a b.png>)\n",
			other:  "### 2026-11-24\n- 09:00 first\n  deeper\n\n  after blank\n  ![](img.png)\n- 11:00 more\n![](<x y.png>)\n",
			want:   "### 2026-11-24\n- 09:00 first\n  deeper\n\n  after blank\n  ![](img.png)\n- 10:00 pic\n  ![alt](<a b.png>)\n- 11:00 more\n  ![](<x y.png>)\n",
		},
		{
			name:   "items before any heading and preambles",
			server: "Quick notes\n\n- 07:00 loose\n### 2026-11-24\n- 09:00 a\n",
			other:  "Other intro\n\n- 06:00 earlier\n- 07:00 loose\n",
			want:   "Quick notes\n\nOther intro\n\n- 06:00 earlier\n- 07:00 loose\n\n### 2026-11-24\n- 09:00 a\n",
		},
		{
			name:   "other preamble already contained",
			server: "Quick notes and more\n\n### 2026-11-24\n- 09:00 a\n",
			other:  "Quick notes\n### 2026-11-24\n- 09:00 a\n",
			want:   "Quick notes and more\n\n### 2026-11-24\n- 09:00 a\n",
		},
		{
			name:   "stray lines kept once per day",
			server: "### 2026-11-24\n- 09:00 a\nstray one\n![](lost.png)\n- 10:00 b\n\n### 2026-11-25\n- 09:00 c\n",
			other:  "### 2026-11-24\n- 09:00 a\nstray one\nstray two\n### 2026-11-25\nheading text\n- 08:00 d\n",
			want:   "### 2026-11-24\n- 09:00 a\n- 10:00 b\n\nstray one\n![](lost.png)\nstray two\n\n### 2026-11-25\n- 08:00 d\n- 09:00 c\n\nheading text\n",
		},
		{
			name:   "both empty",
			server: "",
			other:  "\n",
			want:   "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MergeNotepad(tt.server, tt.other)
			if got != tt.want {
				t.Fatalf("got\n%q\nwant\n%q", got, tt.want)
			}
			if again := MergeNotepad(got, tt.other); again != got {
				t.Fatalf("not idempotent:\n%q\nthen\n%q", got, again)
			}
			if self := MergeNotepad(got, got); self != got {
				t.Fatalf("canonical form changed:\n%q\nthen\n%q", got, self)
			}
		})
	}
}

func TestMergeNotepadCanonicalUnchanged(t *testing.T) {
	for _, x := range []string{
		"### 2026-11-24\n- 09:00 a\n- 10:00 📌 b\n  more\n\n  ![](p.png)\n",
		"Intro\n\n- 08:00 loose\n\n### 2026-11-24\n- 09:00 a\n\nstray\n\n### 2026-11-25\n- 9:30 b\n",
	} {
		if got := MergeNotepad(x, x); got != x {
			t.Errorf("MergeNotepad(x, x) = %q, want %q", got, x)
		}
	}
}

func TestMergeDaily(t *testing.T) {
	const date = "2026-11-26"
	tests := []struct {
		name, server, other, want string
	}{
		{
			name:   "heading stripped",
			server: "## 2026-11-26\n\nserver text\n",
			other:  "## 2026-11-26\n\n\nphone text\n- task\n",
			want:   "## 2026-11-26\n\nserver text\n\nphone text\n- task\n",
		},
		{
			name:   "without heading",
			server: "## 2026-11-26\n\nserver text\n\n\n",
			other:  "phone text\n",
			want:   "## 2026-11-26\n\nserver text\n\nphone text\n",
		},
		{
			name:   "other date heading is kept",
			server: "server text\n",
			other:  "## 2026-11-25\nold\n",
			want:   "server text\n\n## 2026-11-25\nold\n",
		},
		{
			name:   "empty remainder",
			server: "## 2026-11-26\n\nserver text",
			other:  "## 2026-11-26\n\n  \n",
			want:   "## 2026-11-26\n\nserver text",
		},
		{
			name:   "already contained",
			server: "## 2026-11-26\n\nserver text\n\nphone text\n",
			other:  "## 2026-11-26\n\nphone text\n",
			want:   "## 2026-11-26\n\nserver text\n\nphone text\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MergeDaily(tt.server, tt.other, date)
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
			if again := MergeDaily(got, tt.other, date); again != got {
				t.Fatalf("repeated merge changed %q to %q", got, again)
			}
		})
	}
}
