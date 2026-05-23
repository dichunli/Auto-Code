const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// 蓝色修车主题图标 SVG - 扳手居中完整显示
const launcherSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2563eb"/>
      <stop offset="100%" style="stop-color:#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <!-- 扳手图标 - 居中 -->
  <g transform="translate(256, 256) scale(2.2) translate(-50, -50)">
    <path d="M35 15L25 25c-3 3-3 8 0 11l3 3c3 3 8 3 11 0l10-10c2 5 1 11-3 15l-22 22c-3 3-3 8 0 11l5 5c3 3 8 3 11 0l22-22c4-4 10-5 15-3l-10 10c-3 3-3 8 0 11l3 3c3 3 8 3 11 0l15-15c8-8 8-20 0-28l-3-3c-3-3-8-3-11 0l-10 10c-2-5-1-11 3-15l22-22c3-3 3-8 0-11l-5-5c-3-3-8-3-11 0l-22 22c-4 4-10 5-15 3l10-10c3-3 3-8 0-11l-3-3c-3-3-8-3-11 0z" fill="white"/>
  </g>
</svg>`;

// 前景图标 SVG（透明背景，用于自适应图标）
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">
  <g transform="translate(54, 54) scale(0.45) translate(-50, -50)">
    <path d="M35 15L25 25c-3 3-3 8 0 11l3 3c3 3 8 3 11 0l10-10c2 5 1 11-3 15l-22 22c-3 3-3 8 0 11l5 5c3 3 8 3 11 0l22-22c4-4 10-5 15-3l-10 10c-3 3-3 8 0 11l3 3c3 3 8 3 11 0l15-15c8-8 8-20 0-28l-3-3c-3-3-8-3-11 0l-10 10c-2-5-1-11 3-15l22-22c3-3 3-8 0-11l-5-5c-3-3-8-3-11 0l-22 22c-4 4-10 5-15 3l10-10c3-3 3-8 0-11l-3-3c-3-3-8-3-11 0z" fill="white"/>
  </g>
</svg>`;

const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const baseDir = path.join(__dirname, 'android/app/src/main/res');

async function generate() {
  for (const [folder, size] of Object.entries(sizes)) {
    const dir = path.join(baseDir, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 生成普通图标
    await sharp(Buffer.from(launcherSvg))
      .resize(size, size)
      .png()
      .toFile(path.join(dir, 'ic_launcher.png'));

    // 生成圆形图标
    await sharp(Buffer.from(launcherSvg))
      .resize(size, size)
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    // 生成前景图标（用于自适应图标）
    await sharp(Buffer.from(foregroundSvg))
      .resize(size, size)
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    console.log(`已生成 ${folder} (${size}x${size})`);
  }

  // 生成 playstore 图标 (512x512)
  await sharp(Buffer.from(launcherSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(__dirname, 'android/app/src/main/ic_launcher-playstore.png'));
  console.log('已生成 Play Store 图标 (512x512)');

  console.log('\n所有图标生成完毕！');
}

generate().catch(err => {
  console.error('生成失败:', err);
  process.exit(1);
});
