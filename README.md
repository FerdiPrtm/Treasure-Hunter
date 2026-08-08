# 🏆 TREASURE HUNTER

**Pixel Adventure Fantasy** — Game 2D browser berbasis HTML5 Canvas, CSS, dan JavaScript murni (Vanilla JS). Tanpa framework, tanpa build tools, tanpa download asset — semua sprite dan audio dibuat secara prosedural.

> Siap dimainkan cukup dengan membuka `index.html` di browser modern (Chrome, Edge, Firefox).

---

## 🎮 Cara Main

Kumpulkan **semua treasure** di peta. Setelah semuanya terkumpul, **portal** akan muncul — masuk portal untuk naik ke level berikutnya.

- Ada **10 level**, semakin tinggi level: peta makin luas, musuh makin banyak & cepat, treasure makin berharga.
- **Boss** muncul di **Level 5** (Treant King) dan **Level 10** (Dragon Soul).

### Kontrol

| Aksi | Desktop | Mobile |
|---|---|---|
| Bergerak | `WASD` / `Arrow Keys` | Virtual Joystick |
| Sprint | `Shift` | Tombol 🏃 |
| Dash | `Space` | Tombol ⚡ |
| Serang | `Mouse Klik` / `Ctrl` | Tombol ⚔ |
| Pause | `Esc` | Tombol Pause |
| Screenshot | `F2` | — |
| Debug Mode | `F3` | — |
| Mute | `M` | Tombol 🔊 |

### Treasure & Nilai

| Treasure | Nilai |
|---|---|
| 🪙 Coin | 10 |
| 💎 Diamond | 50 |
| 🔴 Ruby | 100 |
| 💚 Emerald | 150 |
| 🏆 Golden Chest | 500 |

### Power-Up (durasi 10 detik)

💨 Speed Boost · 🛡 Shield · 🧲 Coin Magnet · ✨ Double Score · ❤ Heal

### Musuh

Slime · Bat · Skeleton · Goblin · Ghost — dengan AI sederhana (patrol → mengejar → kembali).

---

## Fitur

- **Parallax Forest** — awan bergerak, gunung & hutan berlapis, air & rumput animasi
- **Sistem efek lengkap** — particle, glow, shadow, lighting, screen shake, screen flash, floating damage/score, coin particle, dust, dash trail, slow motion, camera follow/zoom
- **Weather dinamis** — ☀️ Sunny · 🌧 Rain · 🌙 Night · 🌫 Fog · ⚡ Lightning
- **Random event** — Treasure Rain, Enemy Swarm, Speed Wind
- **HUD** — Health, EXP, Level, Score, Coin, Timer, FPS, Enemy Count, Treasure Remaining
- **Minimap** — Player (hijau), Enemy (merah), Treasure (kuning)
- **Combo Score** — perbanyak kill tanpa jeda untuk pengali skor
- **Achievements** & **Daily Reward** (LocalStorage)
- **Save otomatis** — High Score, Level terakhir, Coin, pengaturan suara
- **Audio prosedural** — SFX + Background Music via Web Audio API (tanpa file eksternal), dengan tombol mute
- **Responsive** — Desktop 1280×720, tablet, dan mobile full-screen dengan virtual joystick
- **Optimasi** — `requestAnimationFrame`, delta time, object pool untuk partikel, collision efisien

---

## Struktur Proyek

```
├── index.html          # Canvas + overlay UI (menu, pause, HUD, joystick)
├── style.css           # Tema pixel-adventure, responsif, touch-friendly
├── script.js           # Semua logika game (ES6 classes, modular, berkomentar)
└── assets/
    ├── images/         # (opsional) asset eksternal
    ├── sounds/         # (opsional) audio eksternal
    └── fonts/          # (opsional) font eksternal
```

> Semua sprite & suara digambar/disintesis langsung di canvas — `assets/` disediakan untuk pengembangan lanjutan, game berjalan penuh tanpa isinya.

---

## Cara Menjalankan

1. Clone repositori:
   ```bash
   git clone https://github.com/FerdiPrtm/Treasure-Hunter.git
   cd Treasure-Hunter
   ```
2. Buka `index.html` di browser (klik dua kali, atau jalankan server lokal):
   ```bash
   # opsional
   python -m http.server 8000
   ```
3. Klik **▶ Play** dan mulai berburu harta karun!

---

## Pengembangan

Kode ditulis modular dengan **ES6 Classes** yang terpisah agar mudah dikembangkan:

`Player` · `Enemy` · `Treasure` · `Portal` · `Boss` · `Map` · `Camera` · `Input` · `Audio` · `Particle` · `Weather` · `UI` · `Storage` · `Achievements` · `Game`

**Menambah level/musuh/item** tinggal menyesuaikan config di `script.js`:
- `CFG.LEVELS` — jumlah level
- `pickEnemyType()` / `pickTreasureType()` — komposisi musuh & treasure per level
- Buat subclass baru dari `Enemy` untuk musuh baru

---

## Teknologi

- HTML5
- CSS3
- JavaScript (ES6+)
- HTML5 Canvas
- Web Audio API
- LocalStorage

Tanpa framework · Tanpa build tools · Tanpa CDN wajib

---

Dibuat dengan ❤️ oleh **Ferdi Pratama**
