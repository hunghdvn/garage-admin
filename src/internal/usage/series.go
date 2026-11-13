// Package usage records hourly usage snapshots of every configured Garage
// cluster and shapes them into chart series.
package usage

import (
	"errors"
	"time"
)

// Granularity is the spacing of points in a series.
type Granularity string

const (
	Hour Granularity = "hour"
	Day  Granularity = "day"
)

// ErrBadRange is returned for an unknown range name.
var ErrBadRange = errors.New("invalid range")

const daySecs = 86400

var dayRanges = map[string]int64{"7d": 7, "30d": 30, "90d": 90, "365d": 365}

// RangeStart returns the first timestamp (Unix seconds) to include for rng and
// the granularity to present it at. offsetSec is the viewer's offset east of UTC.
//   - "24h": the last 24 hours, hourly.
//   - "7d", "30d", "90d", "365d": that many local calendar days ending today, daily.
func RangeStart(now time.Time, rng string, offsetSec int) (int64, Granularity, error) {
	if rng == "24h" {
		return now.Truncate(time.Hour).Add(-23 * time.Hour).Unix(), Hour, nil
	}
	days, ok := dayRanges[rng]
	if !ok {
		return 0, "", ErrBadRange
	}
	off := int64(offsetSec)
	todayStart := localDay(now.Unix(), offsetSec)*daySecs - off
	return todayStart - (days-1)*daySecs, Day, nil
}

// LastPerDay keeps, from rows sorted by ascending ts, the last row of each
// local day (offsetSec east of UTC).
func LastPerDay[T any](rows []T, ts func(T) int64, offsetSec int) []T {
	out := make([]T, 0, len(rows))
	for i, r := range rows {
		if i+1 < len(rows) && localDay(ts(rows[i+1]), offsetSec) == localDay(ts(r), offsetSec) {
			continue
		}
		out = append(out, r)
	}
	return out
}

// UntilNextHour is the wait from now to the next full hour.
func UntilNextHour(now time.Time) time.Duration {
	return now.Truncate(time.Hour).Add(time.Hour).Sub(now)
}

// localDay is the day number of ts in a zone offsetSec east of UTC.
func localDay(ts int64, offsetSec int) int64 {
	v := ts + int64(offsetSec)
	d := v / daySecs
	if v%daySecs < 0 {
		d--
	}
	return d
}
