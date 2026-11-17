# Panduan Setup – Aplikasi Tugas Kerja

Waktu setup sekitar 20 menit. Lebih mudah dikerjakan dari laptop; setelah itu aplikasinya dipakai dari HP.

## Isi paket

| File | Fungsi | Ditaruh di mana |
|---|---|---|
| `Code.gs` | Penghubung ke spreadsheet (backend) | Google Apps Script |
| `index.html` | Aplikasi (tampilan) | GitHub Pages |
| `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` | Agar bisa di-install di HP | GitHub Pages |

## Arsitektur singkat

```
HP / laptop  →  index.html di GitHub Pages  →  Apps Script (Code.gs)  →  Google Sheets milikmu
```

- **GitHub Pages** menyimpan tampilan saja, tanpa data. Gratis, dan menjadikan aplikasi PWA sungguhan (ikon sendiri, layar penuh).
- **Apps Script** berjalan atas nama akun Google-mu dan satu-satunya yang menyentuh spreadsheet. Gratis.
- **PIN** dikirim di setiap permintaan. Tanpa PIN yang benar, Apps Script tidak mengembalikan data apa pun.

## Bagian A – Pasang backend di spreadsheet

Catatan: file contoh yang kamu kirim berformat Excel (.xlsx). Apps Script hanya bekerja di format Google Sheets. Kalau file aslimu masih Excel di Drive, buka lalu pilih **File → Simpan sebagai Google Spreadsheet** dan pakai file hasilnya.

1. Buka spreadsheet-mu di Google Sheets.
2. Klik menu **Ekstensi → Apps Script**. Tab baru terbuka.
3. Hapus semua isi yang ada di editor, lalu tempel seluruh isi `Code.gs`.
4. Di baris `const PIN = 'GANTI-PIN-INI';` ganti dengan PIN buatanmu, minimal 8 karakter, campur huruf dan angka. Contoh bentuk: `const PIN = 'kopi-Senin-4821';`
5. Kalau nama tab di file aslimu berbeda dari `Tugas Kerja` dan `Closing & Rutinitas`, sesuaikan dua baris di bawah PIN.
6. Klik ikon simpan (💾).
7. Klik **Deploy → New deployment** (Terapkan → Deployment baru).
8. Klik ikon roda gigi di samping "Select type", pilih **Web app**.
9. Isi:
   - Execute as (Jalankan sebagai): **Me** (Saya)
   - Who has access (Yang memiliki akses): **Anyone** (Siapa saja)
10. Klik **Deploy**. Google meminta izin: pilih akunmu → **Advanced** (Lanjutan) → **Go to … (unsafe)** → **Allow**. Peringatan ini wajar karena script-nya buatan sendiri.
11. Salin **Web app URL** yang berakhiran `/exec`. Simpan, ini dipakai di Bagian C.

"Anyone" di langkah 9 diperlukan agar aplikasi di HP bisa menghubungi script. Yang melindungi datamu adalah PIN, jadi jangan bagikan PIN maupun URL tersebut.

## Bagian B – Pasang aplikasi di GitHub Pages

1. Buat akun gratis di github.com (kalau belum punya).
2. Klik **+ → New repository**. Beri nama bebas, misalnya `tugas`. Pilih **Public**, lalu **Create repository**.
3. Klik **uploading an existing file**, lalu seret 5 file ini: `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`. Jangan unggah `Code.gs`. Klik **Commit changes**.
4. Buka **Settings → Pages**. Di bagian "Branch" pilih **main** dan **/(root)**, klik **Save**.
5. Tunggu 1–2 menit, muat ulang halaman itu. Alamat aplikasimu muncul, bentuknya `https://namaakun.github.io/tugas/`.

Repository-nya publik, tetapi isinya hanya tampilan aplikasi. Tidak ada data, URL script, atau PIN di dalamnya.

## Bagian C – Hubungkan dan install di HP

1. Buka alamat dari Bagian B di HP (Chrome di Android, Safari di iPhone).
2. Tempel **URL Apps Script** dan ketik **PIN**, lalu ketuk **Hubungkan**. Cukup sekali per perangkat.
3. Install ke layar utama:
   - **Android (Chrome):** menu ⋮ → **Tambahkan ke layar utama** / **Install aplikasi**.
   - **iPhone (Safari):** tombol Bagikan → **Tambahkan ke Layar Utama**.
4. Di laptop, buka alamat yang sama di browser dan hubungkan dengan cara yang sama.

## Cara pakai singkat

- **Ubah status (2 ketukan):** ketuk tombol status di kartu → pilih status baru.
- **Tandai selesai (1 ketukan):** ketuk tombol ✓ di kartu. Kolom Tgl selesai dan Progress 100% terisi otomatis.
- **Tambah tugas:** tombol **+** di tengah bawah. ID dibuat otomatis mengikuti pola yang ada (MAS-055, CBS-011, dst).
- **Edit / hapus:** ketuk kartu tugas.
- **Closing & rutinitas:** tab Closing. Ketuk kotak untuk berganti ✅ → 🛠️ → ❌ → kosong.

## Yang perlu kamu tahu

- **Kolom rumus aman.** Aplikasi hanya menulis ke sel yang kamu ubah. Kolom Sisa hari, Alert, dan Fokus # tidak pernah disentuh, dan sel berisi rumus otomatis dilewati.
- **Kolom boleh digeser.** Aplikasi mencari kolom berdasarkan nama header, bukan posisinya. Jangan mengganti nama header ID, Entitas, Task, dan Status.
- **Peran.** Sheet-mu saat ini belum punya kolom Peran. Kalau ingin memakainya, ketik `Peran` di sel S4 (kolom kosong pertama di kanan header). Setelah dimuat ulang, aplikasi otomatis menampilkan isian, filter, dan grafik per Peran.
- **PT baru.** Tambahkan ke daftar dropdown kolom Entitas di sheet, lalu muat ulang aplikasi.
- **Mengubah Code.gs di kemudian hari:** setelah menyimpan, buka **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. URL tetap sama.
- **Ganti PIN:** ubah di Code.gs, deploy versi baru seperti di atas, lalu di aplikasi buka ⚙ → Putuskan, dan hubungkan lagi.
- **Salah PIN 8 kali** mengunci akses 10 menit.

## Checklist pengujian

Kerjakan berurutan dengan spreadsheet terbuka di laptop supaya bisa langsung membandingkan.

**Koneksi**
- [ ] PIN salah ditolak dengan pesan "PIN salah".
- [ ] PIN benar: dashboard tampil dan jumlah tugas sama dengan jumlah baris terisi di tab Tugas Kerja.

**Baca data**
- [ ] Nama PT, prioritas, status, dan deadline di kartu sama dengan di sheet.
- [ ] Tanggal tampil format Indonesia (mis. 16 Nov 2026) dan tidak bergeser satu hari.
- [ ] Tugas dengan deadline lewat berwarna merah "Terlambat"; deadline ≤ 3 hari berwarna kuning.

**Ubah status**
- [ ] Ubah status satu tugas dari HP: kolom Status di baris yang benar berubah, baris lain tidak.
- [ ] Ketuk ✓: Status = Selesai, Progress = 100%, Tgl selesai = hari ini.
- [ ] Kolom Sisa hari, Alert, dan Fokus # di baris itu masih berisi rumus (klik selnya, lihat formula bar).

**Tambah, edit, hapus**
- [ ] Simpan form kosong: muncul peringatan merah di Nama PT dan Judul.
- [ ] Tambah tugas uji: muncul di baris kosong pertama dengan ID baru, Tgl masuk hari ini, dan kolom Alert langsung terisi.
- [ ] Edit catatan dan deadline tugas uji: sel yang sesuai berubah.
- [ ] Hapus tugas uji: muncul konfirmasi, lalu barisnya hilang dari sheet.

**Dashboard dan daftar**
- [ ] Filter PT dan periode mengubah angka ringkasan.
- [ ] Pencarian menemukan tugas dari sebagian judul atau nama PIC.
- [ ] Urut dan kelompokkan berfungsi.
- [ ] Kalender menampilkan titik di tanggal yang punya deadline.

**Closing**
- [ ] Ketuk satu kotak checklist closing: sel yang benar di tab Closing & Rutinitas terisi ✅ dan persentase PT naik.
- [ ] Ketuk satu kotak rutinitas hari ini: sel hari yang benar terisi.

**Sinkronisasi dan install**
- [ ] Ubah sesuatu langsung di sheet, ketuk ↻ di aplikasi: perubahan terbaca.
- [ ] Matikan internet, ubah status: muncul pesan gagal dan status kembali seperti semula.
- [ ] Ikon aplikasi ada di layar utama dan terbuka layar penuh tanpa bar browser.

## Kalau ada masalah

| Gejala | Penyebab umum |
|---|---|
| "PIN belum diganti di Code.gs" | PIN masih bawaan, atau sudah diganti tetapi belum deploy versi baru |
| "Jawaban server tidak dikenali" | URL bukan yang berakhiran `/exec`, atau akses belum "Anyone" |
| "Tab … tidak ditemukan" | Nama tab di Code.gs tidak sama persis dengan di sheet |
| Perubahan Code.gs tidak berpengaruh | Belum deploy **New version** |
| Tampilan lama setelah mengganti index.html | Tutup aplikasi sepenuhnya lalu buka lagi |
