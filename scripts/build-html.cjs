const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const templateDirectory = path.join(root, 'src', 'templates', 'color-grade');
const output = path.join(root, 'color-grade.html');
const templateFiles = [
  'head.html',
  'header.html',
  'canvas-panel.html',
  'adjustments-panel.html',
  'lut-library.html',
  'dialogs.html',
  'scripts.html',
];
const gradeTones = [
  { tone: 'shadow', Tone: 'Shadow', color: '#2e6aa1', hue: 210, saturation: 55, hidden: '' },
  {
    tone: 'mid',
    Tone: 'Mid',
    color: '#6ca56e',
    hue: 122,
    saturation: 24,
    hidden: '                hidden\n',
  },
  {
    tone: 'high',
    Tone: 'High',
    color: '#e3a149',
    hue: 35,
    saturation: 73,
    hidden: '                hidden\n',
  },
];

function renderGradeTones() {
  const template = fs.readFileSync(path.join(templateDirectory, 'grade-tone.html'), 'utf8');
  return gradeTones
    .map((tone) =>
      template.replace(/\{\{(tone|Tone|color|hue|saturation|hidden)\}\}/g, (_, key) => tone[key])
    )
    .join('');
}

const contents = templateFiles.map((file) => {
  const filePath = path.join(templateDirectory, file);
  if (!fs.existsSync(filePath)) throw new Error(`Missing color grade template: ${file}`);
  return fs.readFileSync(filePath, 'utf8').replace('{{GRADE_TONES}}', renderGradeTones().trimEnd());
});

fs.writeFileSync(output, contents.join(''), 'utf8');
console.log(`Generated ${path.relative(root, output)} from ${templateFiles.length} templates.`);
