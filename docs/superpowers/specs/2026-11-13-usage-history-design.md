# Lịch sử dung lượng (cluster & bucket) — Design

**Date:** 2026-11-13
**Status:** Approved design, pending implementation plan

## Mục đích

Xem dung lượng thay đổi theo thời gian cho **từng cluster** và **từng bucket**, dưới dạng biểu đồ.
Garage không lưu lịch sử (Admin API chỉ trả số liệu tức thời), nên garage-admin phải tự chụp và lưu.

## Approaches

| Cách | Đánh đổi | Kết luận |
|---|---|---|
| **Job nền trong garage-admin**, chụp số liệu qua Admin API, lưu SQLite | Không thêm service; chỉ có dữ liệu từ ngày deploy | **Chọn** |
| Prometheus + Grafana đọc `/metrics` của Garage | Thêm 2 service trên NAS 1 GB RAM; Garage không có metric dung lượng theo bucket | Loại |
| Chụp khi có người mở dashboard | Ngày không ai mở sẽ trống, biểu đồ đứt quãng | Loại |

## Quyết định (người dùng)

- Chụp **mỗi giờ 1 lần**.
- Xem **1 ngày** → biểu đồ theo **từng giờ**; xem **nhiều ngày** → biểu đồ theo **từng ngày**.
- Có biểu đồ cho cả cluster lẫn từng bucket.

## Thiết kế

**Thu thập**
- Goroutine nền trong binary: chạy 1 lần khi khởi động, sau đó mỗi giờ.
- Chụp **mọi cluster** đã cấu hình (không chỉ cluster mặc định).
- Cluster: `GetClusterStatistics` → `totalObjectBytes`, `totalObjectCount`, `dataAvail`, `bucketCount`.
- Bucket: `ListBucketsInfo` (Garage ≥ v2.5); bản v2 cũ hơn fallback `ListBuckets` + `GetBucketInfo` từng bucket.
  Lưu `bytes`, `objects`, alias (global đầu tiên, nếu có) tại thời điểm chụp.
- Mốc thời gian làm tròn xuống đầu giờ (UTC); unique theo (cluster, [bucket], giờ) và upsert →
  khởi động lại trong cùng giờ không tạo dòng trùng.
- Lỗi khi gọi Garage: log và bỏ qua lần đó (giờ đó trống trên biểu đồ). Không làm sập app.

**Lưu trữ**
- 2 bảng mới (migration `0002`): cluster usage và bucket usage.
- Giữ dữ liệu theo giờ **31 ngày**; cũ hơn thì thu gọn còn **1 dòng/ngày (bản chụp cuối ngày)**, giữ mãi.
- Khi xoá cluster trong Settings, lịch sử của cluster đó xoá theo.

**API** (đọc, cả `readonly` dùng được, theo cluster đang chọn như các API hiện có)
- Lịch sử cluster và lịch sử một bucket, tham số khoảng thời gian.
- Khoảng `24h` trả điểm theo giờ; khoảng ≥ 7 ngày trả điểm theo ngày = bản chụp cuối của ngày.
- Ranh giới ngày theo **múi giờ trình duyệt** (frontend gửi lên), không theo UTC.

**Giao diện**
- Bộ chọn khoảng: `24 giờ · 7 ngày · 30 ngày · 90 ngày · 1 năm`; "24 giờ" = 24 giờ gần nhất (cuộn).
- **Dashboard**: biểu đồ cluster, 2 đường "Đã dùng" và "Còn trống"; nút chuyển sang "Objects".
- **Trang chi tiết bucket**: biểu đồ dung lượng / số object của bucket đó.
- Chưa có dữ liệu → hiện thông báo "đang thu thập", không hiện biểu đồ rỗng.
- Thư viện: `@mantine/charts` (cùng major với Mantine hiện tại).

## Non-goals

- Biểu đồ so sánh nhiều bucket trên cùng một hình.
- Cảnh báo sắp đầy ổ.
- Dữ liệu trước ngày deploy.
- Chọn một ngày cụ thể trong quá khứ (có thể thêm sau: dữ liệu theo giờ đã có sẵn 31 ngày).

## Để builder quyết

- Schema chi tiết, cách truyền múi giờ (offset phút hay tên IANA — nếu dùng tên IANA thì binary cần
  `time/tzdata` vì image alpine không có tzdata).
- Gom nhóm theo ngày ở SQL hay ở Go.
- Cách căn ticker theo đầu giờ.
