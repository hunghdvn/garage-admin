package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/HungHD/garage-admin/internal/auth"
)

func do(h http.Handler, req *http.Request, cookie *http.Cookie) *httptest.ResponseRecorder {
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

const newUserBody = `{"username":"bob","password":"secretpw1","role":"readonly"}`

func TestCSRFBlocksCrossSitePost(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "admin")
	h := srv.Routes()
	req := jsonReq("POST", "/api/users", strings.NewReader(newUserBody))
	req.Header.Set("Sec-Fetch-Site", "same-site")
	if rec := do(h, req, cookie); rec.Code != http.StatusForbidden {
		t.Errorf("same-site code=%d want 403", rec.Code)
	}
	req = jsonReq("POST", "/api/users", strings.NewReader(newUserBody))
	req.Header.Set("Origin", "http://evil.example.com")
	if rec := do(h, req, cookie); rec.Code != http.StatusForbidden {
		t.Errorf("foreign Origin code=%d want 403", rec.Code)
	}
	req = jsonReq("POST", "/api/users", strings.NewReader(newUserBody))
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	if rec := do(h, req, cookie); rec.Code != http.StatusCreated {
		t.Errorf("same-origin code=%d want 201", rec.Code)
	}
}

func TestCSRFTrustedOrigin(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "admin")
	srv.TrustedOrigins = []string{"https://admin.example.com"}
	req := jsonReq("POST", "/api/users", strings.NewReader(newUserBody))
	req.Header.Set("Origin", "https://admin.example.com")
	if rec := do(srv.Routes(), req, cookie); rec.Code != http.StatusCreated {
		t.Errorf("trusted origin code=%d want 201 body=%s", rec.Code, rec.Body.String())
	}
}

func TestDecodeJSONRequiresJSONContentType(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "admin")
	h := srv.Routes()
	req := httptest.NewRequest("POST", "/api/users", strings.NewReader(newUserBody))
	req.Header.Set("Content-Type", "text/plain")
	if rec := do(h, req, cookie); rec.Code != http.StatusBadRequest {
		t.Errorf("text/plain code=%d want 400", rec.Code)
	}
	req = httptest.NewRequest("POST", "/api/users", strings.NewReader(newUserBody))
	if rec := do(h, req, cookie); rec.Code != http.StatusBadRequest {
		t.Errorf("no content-type code=%d want 400", rec.Code)
	}
	req = httptest.NewRequest("POST", "/api/users", strings.NewReader(newUserBody))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	if rec := do(h, req, cookie); rec.Code != http.StatusCreated {
		t.Errorf("json+charset code=%d want 201", rec.Code)
	}
}

func TestDecodeJSONCapsBody(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "admin")
	big := `{"username":"bob","password":"` + strings.Repeat("a", 2<<20) + `","role":"readonly"}`
	rec := do(srv.Routes(), jsonReq("POST", "/api/users", strings.NewReader(big)), cookie)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("oversized body code=%d want 400", rec.Code)
	}
}

func TestSecurityHeaders(t *testing.T) {
	rec := do((&Server{}).Routes(), jsonReq("GET", "/api/health", nil), nil)
	want := map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "no-referrer",
		"Content-Security-Policy": contentSecurityPolicy,
	}
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func loginReq(user, pw string) *http.Request {
	return jsonReq("POST", "/api/auth/login", strings.NewReader(`{"username":"`+user+`","password":"`+pw+`"}`))
}

func TestLoginRateLimit(t *testing.T) {
	srv := newAPITest(t)
	now := time.Unix(1000, 0)
	srv.LoginLimiter = auth.NewLoginLimiter(func() time.Time { return now })
	h := srv.Routes()
	for i := 0; i < 5; i++ {
		if rec := do(h, loginReq("alice", "bad"), nil); rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d code=%d want 401", i, rec.Code)
		}
	}
	// Correct password must not be evaluated while blocked.
	rec := do(h, loginReq("alice", "pw"), nil)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("code=%d retry-after=%q want 429 with header", rec.Code, rec.Header().Get("Retry-After"))
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Error("blocked login must not set a cookie")
	}
	now = now.Add(16 * time.Minute)
	if rec := do(h, loginReq("alice", "pw"), nil); rec.Code != http.StatusOK {
		t.Errorf("after window code=%d want 200", rec.Code)
	}
}

func TestLoginSuccessClearsCounter(t *testing.T) {
	srv := newAPITest(t)
	h := srv.Routes()
	for i := 0; i < 4; i++ {
		do(h, loginReq("alice", "bad"), nil)
	}
	do(h, loginReq("alice", "pw"), nil)
	for i := 0; i < 4; i++ {
		do(h, loginReq("alice", "bad"), nil)
	}
	if rec := do(h, loginReq("alice", "pw"), nil); rec.Code != http.StatusOK {
		t.Errorf("code=%d want 200 (counter should have reset)", rec.Code)
	}
}

func TestClientIP(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.5:4321"
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 7.7.7.7")
	s := &Server{}
	if got := s.clientIP(req); got != "10.0.0.5" {
		t.Errorf("untrusted: %q want 10.0.0.5", got)
	}
	s.TrustProxy = true
	if got := s.clientIP(req); got != "7.7.7.7" {
		t.Errorf("trusted: %q want right-most 7.7.7.7", got)
	}
	req.Header.Del("X-Forwarded-For")
	if got := s.clientIP(req); got != "10.0.0.5" {
		t.Errorf("trusted without header: %q want RemoteAddr", got)
	}
}

func TestSpoofedXFFDoesNotEvadeLimit(t *testing.T) {
	srv := newAPITest(t) // TrustProxy off
	h := srv.Routes()
	for i := 0; i < 5; i++ {
		req := loginReq("alice", "bad")
		req.Header.Set("X-Forwarded-For", "9.9.9."+string(rune('0'+i)))
		do(h, req, nil)
	}
	req := loginReq("alice", "pw")
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	if rec := do(h, req, nil); rec.Code != http.StatusTooManyRequests {
		t.Errorf("code=%d want 429", rec.Code)
	}
}

func TestPasswordPolicy(t *testing.T) {
	srv, cookie, me := newUsersAPI(t, "admin")
	h := srv.Routes()
	long := strings.Repeat("a", 73)
	for name, body := range map[string]string{
		"short": `{"username":"bob","password":"short","role":"readonly"}`,
		"long":  `{"username":"bob","password":"` + long + `","role":"readonly"}`,
	} {
		if rec := do(h, jsonReq("POST", "/api/users", strings.NewReader(body)), cookie); rec.Code != http.StatusBadRequest {
			t.Errorf("create %s code=%d want 400", name, rec.Code)
		}
	}
	if rec := do(h, jsonReq("POST", "/api/users/"+itoa(me.ID), strings.NewReader(`{"password":"short"}`)), cookie); rec.Code != http.StatusBadRequest {
		t.Errorf("admin reset short code=%d want 400", rec.Code)
	}
	if rec := do(h, jsonReq("POST", "/api/auth/password", strings.NewReader(`{"current_password":"pw","new_password":"short"}`)), cookie); rec.Code != http.StatusBadRequest {
		t.Errorf("self change short code=%d want 400", rec.Code)
	}
	if rec := do(h, jsonReq("POST", "/api/auth/password", strings.NewReader(`{"current_password":"pw","new_password":"`+long+`"}`)), cookie); rec.Code != http.StatusBadRequest {
		t.Errorf("self change long code=%d want 400", rec.Code)
	}
	// 72 bytes is the boundary and must be accepted.
	if rec := do(h, jsonReq("POST", "/api/users", strings.NewReader(`{"username":"bob","password":"`+strings.Repeat("a", 72)+`","role":"readonly"}`)), cookie); rec.Code != http.StatusCreated {
		t.Errorf("72-byte code=%d want 201", rec.Code)
	}
}

func login(t *testing.T, h http.Handler, user, pw string) *http.Cookie {
	t.Helper()
	rec := do(h, loginReq(user, pw), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("login %s code=%d", user, rec.Code)
	}
	return rec.Result().Cookies()[0]
}

func meCode(h http.Handler, c *http.Cookie) int {
	return do(h, jsonReq("GET", "/api/auth/me", nil), c).Code
}

func TestChangePasswordRevokesOtherSessions(t *testing.T) {
	srv, cookie, _ := newUsersAPI(t, "readonly")
	h := srv.Routes()
	other := login(t, h, "me", "pw")
	rec := do(h, jsonReq("POST", "/api/auth/password", strings.NewReader(`{"current_password":"pw","new_password":"newpassword"}`)), cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
	if meCode(h, cookie) != http.StatusOK {
		t.Error("current session should survive")
	}
	if meCode(h, other) != http.StatusUnauthorized {
		t.Error("other session should be revoked")
	}
}

func TestAdminResetRevokesTargetSessions(t *testing.T) {
	srv, adminCookie, _ := newUsersAPI(t, "admin")
	h := srv.Routes()
	hash, _ := auth.HashPassword("pw")
	bob, _ := srv.DB.CreateUser("bob", hash, "readonly")
	bobCookie := login(t, h, "bob", "pw")
	rec := do(h, jsonReq("POST", "/api/users/"+itoa(bob.ID), strings.NewReader(`{"password":"brandnewpw"}`)), adminCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
	if meCode(h, bobCookie) != http.StatusUnauthorized {
		t.Error("target session should be revoked")
	}
	if meCode(h, adminCookie) != http.StatusOK {
		t.Error("admin session should survive")
	}
}

func TestSessionTokenStoredHashed(t *testing.T) {
	srv := newAPITest(t)
	c := login(t, srv.Routes(), "alice", "pw")
	var n int
	srv.DB.SQL().QueryRow(`SELECT COUNT(*) FROM sessions WHERE token=?`, c.Value).Scan(&n)
	if n != 0 {
		t.Error("raw cookie token must not be stored")
	}
}

func TestUpdateClusterEndpointChangeNeedsToken(t *testing.T) {
	srv, cookie := newClusterAPITest(t, "admin")
	h := srv.Routes()
	rec := do(h, jsonReq("POST", "/api/clusters", strings.NewReader(`{"name":"c","admin_endpoint":"http://a:3903","admin_token":"tok"}`)), cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create code=%d", rec.Code)
	}
	put := func(body string) int {
		return do(h, jsonReq("PUT", "/api/clusters/1", strings.NewReader(body)), cookie).Code
	}
	if c := put(`{"name":"c","admin_endpoint":"http://evil:3903"}`); c != http.StatusBadRequest {
		t.Errorf("changed endpoint w/o token code=%d want 400", c)
	}
	if c := put(`{"name":"c2","admin_endpoint":" http://a:3903/ "}`); c != http.StatusOK {
		t.Errorf("cosmetic endpoint change code=%d want 200", c)
	}
	if c := put(`{"name":"c","admin_endpoint":"http://b:3903","admin_token":"new"}`); c != http.StatusOK {
		t.Errorf("changed endpoint with token code=%d want 200", c)
	}
}

func TestFilesDoesNotLeakInternalErrors(t *testing.T) {
	h, cookie := newFilesAPI(t, "admin", &fakeS3{})
	// A nonexistent cluster yields a SQL error from the lookup.
	rec := do(h, jsonReq("GET", "/api/files?bucket=b&cluster=999", nil), cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code=%d want 400", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "sql") || strings.Contains(rec.Body.String(), "no rows") {
		t.Errorf("leaked internal error: %s", rec.Body.String())
	}
}

func TestUploadAcceptsAnyContentType(t *testing.T) {
	fake := &fakeS3{}
	h, cookie := newFilesAPI(t, "admin", fake)
	req := httptest.NewRequest("POST", "/api/files/upload?bucket=b&key=a.bin", strings.NewReader("data"))
	req.Header.Set("Content-Type", "application/octet-stream")
	if rec := do(h, req, cookie); rec.Code != http.StatusOK || fake.putBody != "data" {
		t.Errorf("upload code=%d body=%s put=%q", rec.Code, rec.Body.String(), fake.putBody)
	}
}

func TestLoginConcurrentWrongPasswordsLimited(t *testing.T) {
	srv := newAPITest(t)
	h := srv.Routes()
	var wg sync.WaitGroup
	var evaluated, blocked atomic.Int32
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			switch do(h, loginReq("alice", "bad"), nil).Code {
			case http.StatusUnauthorized:
				evaluated.Add(1)
			case http.StatusTooManyRequests:
				blocked.Add(1)
			}
		}()
	}
	wg.Wait()
	if evaluated.Load() != 5 || blocked.Load() != 45 {
		t.Errorf("evaluated=%d blocked=%d, want 5/45", evaluated.Load(), blocked.Load())
	}
}
