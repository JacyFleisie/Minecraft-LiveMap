```
 __    __   ___    ___  ___                    __    __              __
|  \  |  \ |  \  /  _]|  \                  |  \  /  \            |  \
| $$  | $$  $$  /  [_ | $$____    ______   _| $$_ | $$  _______  _| $$
| $$__| $$| $$ /    $$| $$    \  /      \ |   $$ \| $$ |       \|   $$
| $$    $$| $$|  $$$$$| $$$$$$\|  $$$$$$\ \$$$$$$| $$ | $$$$$$$\$$$$$$
| $$$$$$$$| $$| $$  $| $$  | $$| $$    $$  | $$ __| $$| $$       | $$
| $$  | $$| $$| $$__| $$| $$__/ $$| $$$$$$$$  | $$|  \ $$| $$_____  $$
| $$  | $$| $$ \$$    $$| $$    $$ \$$     \   \$$ $$ \$$ \$$     \ $$
 \$$   \$$ \$$  \$$$$$$  \$$$$$$$   \$$$$$$$    \$$$$$\  \$$$$$$$ \$$
```
# Minecraft LiveMap

> Real-time coordinate tracker and seed viewer for Minecraft Bedrock Edition

[![Build](https://github.com/JacyFleisie/Minecraft-LiveMap/actions/workflows/build.yml/badge.svg)](https://github.com/JacyFleisie/Minecraft-LiveMap/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/JacyFleisie/Minecraft-LiveMap/releases)

---

## 📸 Screenshots

| Map View | Seed Viewer | Waypoints |
|:---:|:---:|:---:|
| ![Map View](docs/screenshots/map-view.png) | ![Seed Viewer](docs/screenshots/seed-viewer.png) | ![Waypoints](docs/screenshots/waypoints.png) |

---

## ✨ Features

- **🗺️ Real-time Map** — Live map of your Minecraft Bedrock world with chunk borders, biome overlays, and coordinates
- **🌱 Seed Viewer** — View your world seed and explore terrain generation patterns
- **📍 Waypoints** — Create and manage waypoints for important locations, caves, and structures
- **🏛️ Structure Locator** — Find villages, temples, strongholds, and other structures in your world
- **📊 Player Stats** — Track movement, distance traveled, and time played
- **🎨 Multiple Map Styles** — Choose between different visual themes (classic, dark, top-down)
- **⚡ Lightweight** — Minimal performance impact on your system
- **🔄 Auto-updater** — Stay up-to-date with the latest features and fixes automatically

---

## 📥 Installation

### Download the Latest Release

1. Go to the [Releases page](https://github.com/JacyFleisie/Minecraft-LiveMap/releases)
2. Download the latest `LiveMapDesktop.exe` installer
3. Run the executable and follow the installation prompts

### System Requirements

- **OS:** Windows 10/11 (64-bit)
- **Framework:** .NET 10.0 or later
- **Minecraft:** Bedrock Edition (Windows 10/11 Edition)

---

## 🎮 Usage

### Getting Started

1. **Launch Minecraft Bedrock Edition** and load your world
2. **Run LiveMapDesktop** — the application will automatically detect your running Minecraft instance
3. **Explore!** Your map will update in real-time as you move around the world

### Key Features

| Feature | How to Use |
|---|---|
| **Toggle Map** | Press `M` to show/hide the map overlay |
| **Add Waypoint** | Press `B` or click the "+" button on the map |
| **View Seed** | Go to `Tools → Seed Viewer` in the menu |
| **Find Structures** | Go to `Tools → Structure Locator` |
| **Change Theme** | `Settings → Theme` to switch visual styles |
| **Toggle Overlay** | `Ctrl + M` to toggle the in-game overlay |

### Configuration

- **Map Scale:** Scroll to zoom in/out
- **Follow Player:** Toggle automatic camera following
- **Show Coordinates:** Display player coordinates on the map
- **Opacity:** Adjust map transparency for better visibility

---

## 🔄 Auto-Updater

LiveMapDesktop includes a built-in auto-updater. When a new version is available:

1. A notification will appear in the application
2. Click **"Update Now"** to download and install the latest version
3. The application will restart with the new version

You can also manually check for updates via `Help → Check for Updates`.

---

## 🛠️ Development

### Building from Source

```bash
git clone https://github.com/JacyFleisie/Minecraft-LiveMap.git
cd Minecraft-LiveMap
dotnet build src/LiveMapDesktop/LiveMapDesktop.csproj -c Release
```

### Running

```bash
dotnet run --project src/LiveMapDesktop/LiveMapDesktop.csproj
```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Minecraft Bedrock community for protocol documentation
- Contributors and testers

---

<p align="center">
  <sub>Built with ❤️ for the Minecraft community</sub>
</p>
