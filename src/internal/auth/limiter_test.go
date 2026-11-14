package auth

import (
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

func TestLimiterPairBlocksAfterFive(t *testing.T) {
	c := &fakeClock{t: time.Unix(1000, 0)}
	l := NewLoginLimiter(c.now)
	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow("1.1.1.1", "Alice"); !ok {
			t.Fatalf("blocked early at %d", i)
		}
	}
	ok, wait := l.Allow("1.1.1.1", " alice ")
	if ok || wait <= 0 {
		t.Fatalf("expected block with retry, ok=%v wait=%v", ok, wait)
	}
	if ok, _ := l.Allow("1.1.1.1", "bob"); !ok {
		t.Error("other username should not be blocked")
	}
	if ok, _ := l.Allow("2.2.2.2", "alice"); !ok {
		t.Error("other IP should not be blocked")
	}
	c.t = c.t.Add(loginWindow + time.Second)
	if ok, _ := l.Allow("1.1.1.1", "alice"); !ok {
		t.Error("should be allowed after window")
	}
}

func TestLimiterSuccessClearsPair(t *testing.T) {
	l := NewLoginLimiter((&fakeClock{t: time.Unix(1000, 0)}).now)
	for i := 0; i < 4; i++ {
		l.Allow("1.1.1.1", "alice")
	}
	l.Allow("1.1.1.1", "alice") // the successful attempt
	l.Success("1.1.1.1", "alice")
	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow("1.1.1.1", "alice"); !ok {
			t.Fatalf("counter should have been cleared (attempt %d)", i)
		}
	}
	if ok, _ := l.Allow("1.1.1.1", "alice"); ok {
		t.Error("expected block after 5 new attempts")
	}
}

func TestLimiterSuccessGivesBackIPSlot(t *testing.T) {
	l := NewLoginLimiter((&fakeClock{t: time.Unix(1000, 0)}).now)
	for i := 0; i < 100; i++ {
		if ok, _ := l.Allow("1.1.1.1", "alice"); !ok {
			t.Fatalf("successful logins consumed IP budget at %d", i)
		}
		l.Success("1.1.1.1", "alice")
	}
}

func TestLimiterReleaseGivesBackSlots(t *testing.T) {
	l := NewLoginLimiter((&fakeClock{t: time.Unix(1000, 0)}).now)
	for i := 0; i < 20; i++ {
		l.Allow("1.1.1.1", "alice")
		l.Release("1.1.1.1", "alice")
	}
	if ok, _ := l.Allow("1.1.1.1", "alice"); !ok {
		t.Error("released slots should not count")
	}
}

func TestLimiterConcurrentAdmitsAtMostFive(t *testing.T) {
	l := NewLoginLimiter(nil)
	var admitted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, _ := l.Allow("1.1.1.1", "alice"); ok {
				admitted.Add(1)
			}
		}()
	}
	wg.Wait()
	if n := admitted.Load(); n != 5 {
		t.Errorf("admitted %d, want 5", n)
	}
}

func TestLimiterPerIPBlocksAcrossUsernames(t *testing.T) {
	l := NewLoginLimiter((&fakeClock{t: time.Unix(1000, 0)}).now)
	for i := 0; i < 30; i++ {
		l.Allow("1.1.1.1", "user"+string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	if ok, _ := l.Allow("1.1.1.1", "fresh"); ok {
		t.Error("IP should be blocked after 30 failures")
	}
}

func TestLimiterCleanupBoundsMemory(t *testing.T) {
	c := &fakeClock{t: time.Unix(1000, 0)}
	l := NewLoginLimiter(c.now)
	for i := 0; i < 100; i++ {
		l.Allow("1.1.1.1", strings.Repeat("x", i+1))
	}
	if l.size() == 0 {
		t.Fatal("expected entries")
	}
	c.t = c.t.Add(loginWindow + 2*cleanupEvery)
	l.Allow("9.9.9.9", "z")
	// Only the fresh reservation made by the Allow above (pair + IP) remains.
	if n := l.size(); n != 2 {
		t.Errorf("size = %d after cleanup, want 2", n)
	}
}

func TestLimiterLongUsernameKeyCapped(t *testing.T) {
	l := NewLoginLimiter((&fakeClock{t: time.Unix(1000, 0)}).now)
	long := strings.Repeat("a", 1000)
	if k := pairKey("1.1.1.1", long); len(k) > 80 {
		t.Errorf("key too long: %d", len(k))
	}
	_ = l
}
