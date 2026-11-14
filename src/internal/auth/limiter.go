package auth

import (
	"strings"
	"sync"
	"time"
)

const (
	loginWindow       = 15 * time.Minute
	maxFailsPerPair   = 5  // per (client IP, username)
	maxFailsPerIP     = 30 // per client IP, across usernames
	maxUsernameKeyLen = 64
	cleanupEvery      = time.Minute
)

type failEntry struct {
	count int
	reset time.Time // end of the fixed window opened by the first failure
}

// LoginLimiter is an in-memory failed-login limiter. Only failures are counted;
// state is lost on restart, which is acceptable for a small single-node app.
type LoginLimiter struct {
	mu          sync.Mutex
	now         func() time.Time // injectable for tests
	pairs       map[string]*failEntry
	ips         map[string]*failEntry
	lastCleanup time.Time
}

// NewLoginLimiter creates a limiter. A nil now uses time.Now.
func NewLoginLimiter(now func() time.Time) *LoginLimiter {
	if now == nil {
		now = time.Now
	}
	return &LoginLimiter{now: now, pairs: map[string]*failEntry{}, ips: map[string]*failEntry{}, lastCleanup: now()}
}

func pairKey(ip, username string) string {
	u := strings.ToLower(strings.TrimSpace(username))
	if len(u) > maxUsernameKeyLen {
		u = u[:maxUsernameKeyLen]
	}
	// IP cannot contain NUL, so it is a safe separator.
	return ip + "\x00" + u
}

// Allow atomically reserves a slot for a login attempt. It returns ok=false
// (reserving nothing) when the (ip, username) or per-IP budget is used up, with
// retryAfter set to the end of the blocking window. A reservation is kept as a
// failure unless the caller hands it back with Success or Release; counting
// attempts in flight, not completed failures, stops parallel requests from
// slipping past the limit while bcrypt runs.
func (l *LoginLimiter) Allow(ip, username string) (ok bool, retryAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweepLocked(now)
	pk := pairKey(ip, username)
	var wait time.Duration
	if e := l.pairs[pk]; e != nil && now.Before(e.reset) && e.count >= maxFailsPerPair {
		wait = e.reset.Sub(now)
	}
	if e := l.ips[ip]; e != nil && now.Before(e.reset) && e.count >= maxFailsPerIP {
		if d := e.reset.Sub(now); d > wait {
			wait = d
		}
	}
	if wait > 0 {
		return false, wait
	}
	bump(l.pairs, pk, now)
	bump(l.ips, ip, now)
	return true, 0
}

// Success clears the (ip, username) counter and returns the IP slot reserved
// by this attempt, so successful logins do not consume the per-IP budget.
func (l *LoginLimiter) Success(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.pairs, pairKey(ip, username))
	give(l.ips, ip)
}

// Release returns the slots reserved by an attempt that was not a credential
// failure (e.g. an internal error).
func (l *LoginLimiter) Release(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	give(l.pairs, pairKey(ip, username))
	give(l.ips, ip)
}

func give(m map[string]*failEntry, key string) {
	if e := m[key]; e != nil && e.count > 0 {
		e.count--
	}
}

func bump(m map[string]*failEntry, key string, now time.Time) {
	e := m[key]
	if e == nil || !now.Before(e.reset) {
		e = &failEntry{reset: now.Add(loginWindow)}
		m[key] = e
	}
	e.count++
}

// sweepLocked drops expired entries so memory stays bounded.
func (l *LoginLimiter) sweepLocked(now time.Time) {
	if now.Sub(l.lastCleanup) < cleanupEvery {
		return
	}
	l.lastCleanup = now
	for k, e := range l.pairs {
		if !now.Before(e.reset) {
			delete(l.pairs, k)
		}
	}
	for k, e := range l.ips {
		if !now.Before(e.reset) {
			delete(l.ips, k)
		}
	}
}

// size is used by tests.
func (l *LoginLimiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.pairs) + len(l.ips)
}
