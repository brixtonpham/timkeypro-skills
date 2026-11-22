# Phong cách có sẵn

Dùng khi bạn chưa có video mẫu để đo. Mỗi thư mục chứa một `style.json` cùng dạng với file
`measure-style.mjs` tạo ra, nên `apply-style.mjs` dùng được ngay.

Đây là **giá trị khởi điểm do TimKeyPro chọn**, không đo từ kênh nào và không hứa hẹn lượt xem.
Hãy chỉnh cho hợp giọng và nội dung của bạn (`"source": {"kind": "preset"}` trong mỗi file).
Vì không đo từ video thật, các trường chỉ có khi đo (`cut_times_s`, `curve_cpm_per_30s`,
`audio.beat`, `grade.measured`) để `null`.

| Slug | Tên | Dùng cho | Khung | Cắt/phút | Phụ đề |
|---|---|---|---|---|---|
| `lich-su-ke-chuyen` | Kể chuyện lịch sử | Video dài kể chuyện lịch sử, nhân vật, bí ẩn | 16:9 | 10 | Chữ có chân trắng viền đen, 5 từ/lần, sát đáy, không tô màu |
| `top-10-su-that` | Top 10 sự thật | Video danh sách top 10, "điều bạn chưa biết" | 16:9 | 24 | In hoa đậm, 3 từ/lần, tô vàng từ khóa, hiện bật |
| `review-tiktok-shop` | Review sản phẩm TikTok Shop | Video ngắn review, đập hộp, gắn giỏ hàng | 9:16 | 40 | Rất to, in hoa, 2 từ/lần, tô vàng từ đang đọc, ở 62% chiều cao |
| `trich-dan-dong-luc` | Trích dẫn động lực | Câu nói hay, bài học cuộc sống, nhạc dẫn dắt | 9:16 | 12 | Chữ có chân giữa khung, nền đen mờ, 4 từ/lần, hiện dần |
| `tin-nhanh-60-giay` | Tin tức nhanh 60 giây | Bản tin ngắn một phút | 9:16 | 24 | Chữ hẹp trên nền xanh đậm, 3 từ/lần, tô đỏ từ khóa |

Lý do chọn từng giá trị nằm trong trường `notes` của mỗi file.
