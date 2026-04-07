import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import QRCode from 'qrcode'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..')
const configPath = path.join(repoRoot, 'scripts/qr-codes/public-pace-checkpoints.json')
const outputDir = path.join(repoRoot, 'public/qr')

function getBaseUrl() {
  const explicit = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/$/, '')
  }

  return 'http://localhost:3000'
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function main() {
  const baseUrl = getBaseUrl()
  const checkpoints = JSON.parse(await fs.readFile(configPath, 'utf8'))
  await fs.mkdir(outputDir, { recursive: true })

  const generated = []

  for (const checkpoint of checkpoints) {
    const url = `${baseUrl}/scan/${encodeURIComponent(checkpoint.token)}`
    const filename = `${slugify(checkpoint.token)}.svg`
    const outputPath = path.join(outputDir, filename)
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 960,
      color: {
        dark: '#143728',
        light: '#ffffff',
      },
    })

    await fs.writeFile(outputPath, svg)
    generated.push({
      ...checkpoint,
      url,
      filename,
    })
  }

  const printableHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>planit.golf public checkpoint QR codes</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #143728; }
    main { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    article { break-inside: avoid; border: 2px solid #143728; border-radius: 24px; padding: 24px; text-align: center; }
    img { width: 100%; max-width: 360px; }
    h1 { grid-column: 1 / -1; font-size: 28px; margin: 0; }
    h2 { font-size: 24px; margin: 16px 0 8px; }
    p { overflow-wrap: anywhere; margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>planit.golf public checkpoint QR codes</h1>
    ${generated
      .map(
        (checkpoint) => `<article>
      <img src="./${escapeHtml(checkpoint.filename)}" alt="${escapeHtml(checkpoint.label)} QR code">
      <h2>${escapeHtml(checkpoint.label)}</h2>
      <p>${escapeHtml(checkpoint.url)}</p>
    </article>`,
      )
      .join('\n')}
  </main>
</body>
</html>
`

  await fs.writeFile(path.join(outputDir, 'public-pace-checkpoints.html'), printableHtml)

  for (const checkpoint of generated) {
    console.log(`${checkpoint.label}: public/qr/${checkpoint.filename} -> ${checkpoint.url}`)
  }
  console.log('Printable sheet: public/qr/public-pace-checkpoints.html')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
