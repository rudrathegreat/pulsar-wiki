// Shared soft-wrap measurements for the Markdown and BibTeX source editors.
window.SourceEditor = function (editor, source, numbers) {
  const mirror = document.createElement('div');
  mirror.className = 'wiki-editor-measure';
  mirror.setAttribute('aria-hidden', 'true');
  source.append(mirror);
  let offsets = [];
  const syncScroll = () => {
    numbers.style.transform = `translateY(${-editor.scrollTop}px)`;
  };
  function sync() {
    const lines = editor.value.split('\n');
    source.style.setProperty('--line-number-digits', Math.max(2, String(lines.length).length));
    const style = window.getComputedStyle(editor);
    const width = editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (width <= 0 || !Number.isFinite(width)) return;
    mirror.style.width = `${width}px`;
    mirror.style.font = style.font;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.tabSize = style.tabSize;
    mirror.replaceChildren(...lines.map(line => {
      const row = document.createElement('div');
      row.textContent = line || '\u200b';
      return row;
    }));
    let offset = 0;
    const rows = Array.from(mirror.children, (row, index) => {
      offsets[index] = offset;
      const height = row.getBoundingClientRect().height;
      offset += height;
      const number = document.createElement('div');
      number.textContent = index + 1;
      number.style.height = `${height}px`;
      return number;
    });
    offsets.length = lines.length;
    numbers.replaceChildren(...rows);
    syncScroll();
  }
  editor.addEventListener('scroll', syncScroll);
  const observer = new ResizeObserver(() => {
    if (editor.isConnected === false) { observer.disconnect(); return; }
    sync();
  });
  observer.observe(editor);
  document.fonts.ready.then(() => { if (editor.isConnected) sync(); });
  return {
    sync,
    syncScroll,
    lineOffset: line => offsets[line] || 0,
    destroy() { observer.disconnect(); mirror.remove(); },
  };
};
