package usage

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

const vietnam = 7 * 3600

func TestRangeStart24h(t *testing.T) {
	since, g, err := RangeStart(mustTime(t, "2026-11-13T10:25:00Z"), "24h", vietnam)
	if err != nil {
		t.Fatal(err)
	}
	if want := mustTime(t, "2026-11-12T11:00:00Z").Unix(); since != want || g != Hour {
		t.Fatalf("got %v %q, want %v hour", time.Unix(since, 0).UTC(), g, time.Unix(want, 0).UTC())
	}
}

func TestRangeStart7dLocal(t *testing.T) {
	// 20:00Z is already 03:00 on 14/11 in UTC+7; 7 local days = 08/11 .. 14/11.
	since, g, err := RangeStart(mustTime(t, "2026-11-13T20:00:00Z"), "7d", vietnam)
	if err != nil {
		t.Fatal(err)
	}
	if want := mustTime(t, "2026-11-07T17:00:00Z").Unix(); since != want || g != Day {
		t.Fatalf("got %v %q, want %v day", time.Unix(since, 0).UTC(), g, time.Unix(want, 0).UTC())
	}
}

func TestRangeStartAllDayRanges(t *testing.T) {
	now := mustTime(t, "2026-11-13T05:00:00Z") // 12:00 local
	for rng, days := range map[string]int{"7d": 7, "30d": 30, "90d": 90, "365d": 365} {
		since, g, err := RangeStart(now, rng, vietnam)
		if err != nil || g != Day {
			t.Fatalf("%s: %v %q", rng, err, g)
		}
		want := mustTime(t, "2026-11-12T17:00:00Z").Add(-time.Duration(days-1) * 24 * time.Hour).Unix()
		if since != want {
			t.Errorf("%s: got %v want %v", rng, time.Unix(since, 0).UTC(), time.Unix(want, 0).UTC())
		}
	}
}

func TestRangeStartRejectsUnknown(t *testing.T) {
	if _, _, err := RangeStart(time.Now(), "2d", 0); !errors.Is(err, ErrBadRange) {
		t.Fatalf("err = %v", err)
	}
}

func TestLastPerDayUsesLocalDay(t *testing.T) {
	rows := []int64{
		mustTime(t, "2026-11-13T16:00:00Z").Unix(), // 23:00 on 13/11 local
		mustTime(t, "2026-11-13T19:00:00Z").Unix(), // 02:00 on 14/11 local
		mustTime(t, "2026-11-13T20:00:00Z").Unix(), // 03:00 on 14/11 local
	}
	got := LastPerDay(rows, func(ts int64) int64 { return ts }, vietnam)
	if want := []int64{rows[0], rows[2]}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestLastPerDayEmpty(t *testing.T) {
	if got := LastPerDay([]int64(nil), func(ts int64) int64 { return ts }, 0); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestUntilNextHour(t *testing.T) {
	if got := UntilNextHour(mustTime(t, "2026-11-13T10:25:30Z")); got != 34*time.Minute+30*time.Second {
		t.Fatalf("got %v", got)
	}
}
