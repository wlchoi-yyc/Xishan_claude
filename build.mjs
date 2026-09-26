// 產生可離線直接雙擊開啟的單檔版本（dist/index.html）
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const out = await build({ entryPoints: ['js/main.js'], bundle: true, format: 'iife', minify: true, write: false, charset: 'utf8' });
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const css = readFileSync('css/style.css', 'utf8');
let html = readFileSync('index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace(/<section id="authGate"[\s\S]*?<\/section>/, '');
html = html.replace('<div id="experience" hidden>', '<div id="experience">');
html = html.replace(/<button id="authLogout"[^>]*>登出<\/button>/, '');
html = html.replace(/<script src="\/__\/firebase\/[^\n]+\n/g, '');
html = html.replace('<script type="module" src="auth.js"></script>', () => `<script>\n${js}\n</script>`);
writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024 / 1024).toFixed(2), 'MB');
