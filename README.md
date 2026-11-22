# TimKeyPro Skills cho Claude

Bộ skill video miễn phí cho **Claude của chính bạn**. Claude làm việc trên máy bạn, với video và giọng của bạn.
TimKeyPro không nhận file video nào của bạn.

| Skill | Làm gì |
|---|---|
| `clone-edit-style` | Đo **phong cách edit** của một video bất kỳ (nhịp cắt, tốc độ mở đầu, kiểu phụ đề, zoom, mức nhạc nền, màu), lưu thành `style.json`, rồi dựng **nháp CapCut** từ giọng đọc và b-roll của bạn theo đúng phong cách đó. |
| `kich-ban-ban-hang` | Viết **kịch bản video bán hàng** 15/30/60 giây cho TikTok Shop, Shopee Video, Facebook Reels bằng tiếng Việt nói tự nhiên, không "văn AI". Hỏi sản phẩm, người mua, giá và bằng chứng thật bạn có; không bịa số liệu hay review. |
| `mot-video-nhieu-nen-tang` | Biến **một video dài** thành bài đăng cho YouTube Shorts, TikTok, Instagram Reels, Facebook Reels, mô tả YouTube và Threads/X: độ dài, tỉ lệ, caption, hashtag, hook, CTA theo từng nền tảng, xuất thành bảng để dán. |
| `hook-5-giay` | Viết và **chấm điểm hook 5 giây** cho video không mặt theo 5 kiểu (câu hỏi, con số, đối lập, câu chuyện, khẳng định). Có kết nối TimKeyPro thì dựa vào video outlier trong ngách làm bằng chứng. |
| `kiem-tra-chan-thuc` | **Tự kiểm tra trước khi đăng** theo quy định "nội dung không chân thực" của YouTube và nhãn nội dung AI (AIGC) của TikTok: chấm điểm, chỉ ra chỗ cần sửa. Chỉ là tự kiểm tra, không phải quyết định của YouTube. |

Skill chỉ chép **cách dựng**, không chép **nội dung**: không lấy hình, nhạc, giọng hay chữ của video gốc.

## Cài đặt (5 phút)

### 1. Cài công cụ trên máy

Cần Node 18+, ffmpeg, và whisper.cpp nếu muốn tự tạo phụ đề tiếng Việt.

macOS:

```bash
brew install node ffmpeg whisper-cpp
mkdir -p ~/.cache/whisper-cpp
curl -L -o ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

Windows (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS Gyan.FFmpeg
```

Với Windows, tải `whisper-bin-x64.zip` ở trang releases của whisper.cpp và file model như trên.

### 2. Thêm skill vào Claude Code

```text
/plugin marketplace add brixtonpham/timkeypro-skills
/plugin install timkeypro-video@timkeypro
```

Claude Code cần gói Claude Pro trở lên.

### 3. Thêm dữ liệu YouTube (tùy chọn, miễn phí)

Kết nối TimKeyPro để Claude tìm video "outlier" trong ngách của bạn làm mẫu:

```bash
claude mcp add --transport http timkeypro https://mcp.timkeypro.com/mcp
```

Sau đó gõ `/mcp`, chọn `timkeypro`, bấm Authenticate. Hướng dẫn đầy đủ: https://timkeypro.com/claude

## Dùng thế nào

Mở Claude Code trong thư mục có video, rồi nói bằng tiếng Việt:

```text
Dựng giống video này: ~/Downloads/video-mau.mp4
```

Claude sẽ:

1. Đo video mẫu và đọc vài khung hình (khoảng 10 giây với video 1 phút).
2. Cho bạn xem "thẻ phong cách": nhịp cắt, kiểu mở đầu, kiểu phụ đề, zoom, âm thanh.
3. Lưu phong cách với tên bạn chọn, rồi xóa khung hình của video mẫu.
4. Hỏi giọng đọc, thư mục b-roll, nhạc nền và tiêu đề của bạn.
5. Dựng nháp trong CapCut. Mở CapCut, dự án mới nằm trong danh sách, mọi đoạn đều sửa được.

Lần sau chỉ cần:

```text
Làm video mới theo phong cách "kể chuyện nhanh", giọng ở voice.mp3, b-roll ở thư mục clips
```

## Lưu ý để không mất kiếm tiền

- Video chỉ gồm clip stock + giọng AI theo một khuôn cố định có thể bị YouTube coi là "nội dung không chân thực".
  Hãy thay đổi b-roll, thêm bình luận hoặc cảnh quay của bạn.
- Trên TikTok, gắn nhãn nội dung AI (AIGC) khi nền tảng yêu cầu.
- Chỉ dùng nhạc, clip và giọng bạn có quyền dùng.

## Kiểm tra skill chạy đúng

```bash
node plugins/timkeypro-video/skills/clone-edit-style/tests/selftest.mjs
```

Bài kiểm tra tạo một video có 12 lần cắt và nhạc 128 BPM đã biết trước, rồi kiểm tra skill đo đúng.

---

## English

Free video skills for your own Claude. `clone-edit-style` measures the edit style of any reference video
(pacing, hook speed, caption look, zooms, music level, colour) into `style.json`, then builds an editable
CapCut draft from your own voice and b-roll. It copies how a video is edited, never what is in it.
`kich-ban-ban-hang` writes short sales scripts for TikTok Shop, Shopee Video and Facebook Reels in natural spoken
Vietnamese, with no invented claims. `mot-video-nhieu-nen-tang` turns one long video into paste-ready posts for
Shorts, TikTok, Reels, Facebook, the YouTube description and Threads/X. `hook-5-giay` writes and scores 5-second
hooks for faceless videos. `kiem-tra-chan-thuc` is a pre-upload self-check against YouTube's inauthentic content
rule and TikTok's AI content label.
Install with `/plugin marketplace add brixtonpham/timkeypro-skills`, then `/plugin install timkeypro-video@timkeypro`.

CapCut drafts are built with [capcut-cli](https://github.com/renezander030/capcut-cli) (MIT), downloaded by
`npx` on first use. TimKeyPro is not affiliated with CapCut or ByteDance.

Licence: MIT.
