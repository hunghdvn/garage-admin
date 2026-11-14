// Package auth handles password hashing, sessions, and request authentication.
package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

const (
	MinPasswordLen = 8
	MaxPasswordLen = 72 // bcrypt ignores/rejects bytes beyond 72
)

// ValidatePassword enforces the password policy (8 characters minimum, 72
// bytes maximum).
func ValidatePassword(p string) error {
	if len(p) > MaxPasswordLen {
		return errors.New("mật khẩu quá dài (tối đa 72 byte)")
	}
	if len([]rune(p)) < MinPasswordLen {
		return errors.New("mật khẩu phải có ít nhất 8 ký tự")
	}
	return nil
}

// HashPassword returns a bcrypt hash of the password.
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

// VerifyPassword reports whether plain matches the bcrypt hash.
func VerifyPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
