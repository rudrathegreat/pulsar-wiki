'use strict';

// Keep the form controls as the source of truth for search requests.
document.querySelectorAll('.source-result-controls select').forEach(select => {
  const label = select.closest('label');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = `${select.id}-trigger`;
  trigger.className = 'source-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const labelText = document.createElement('span');
  labelText.id = `${select.id}-label`;
  labelText.textContent = label.firstChild.textContent.trim();
  label.firstChild.replaceWith(labelText);
  label.htmlFor = trigger.id;
  trigger.setAttribute('aria-labelledby', `${labelText.id} ${trigger.id}`);

  const menu = document.createElement('div');
  menu.id = `${select.id}-options`;
  menu.className = 'source-select-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', labelText.id);
  trigger.setAttribute('aria-controls', menu.id);
  const options = Array.from(select.options, (option, index) => {
    const item = document.createElement('div');
    item.id = `${select.id}-option-${index}`;
    item.className = 'source-select-option';
    item.setAttribute('role', 'option');
    item.textContent = option.textContent;
    item.addEventListener('pointerdown', event => event.preventDefault());
    item.addEventListener('click', () => choose(index));
    menu.append(item);
    return item;
  });
  let active = select.selectedIndex;
  let prefix = '';
  let lastTyped = 0;
  const isOpen = () => menu.matches(':popover-open');
  function highlight(index) {
    active = index;
    options.forEach((item, i) => item.classList.toggle('is-active', i === active));
    trigger.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({ block: 'nearest' });
  }
  function sync() {
    trigger.textContent = select.selectedOptions[0].textContent;
    options.forEach((item, i) => item.setAttribute('aria-selected', String(i === select.selectedIndex)));
  }
  function position() {
    if (!isOpen()) return;
    const rect = trigger.getBoundingClientRect();
    menu.style.width = `${Math.min(Math.max(rect.width, 220), window.innerWidth - 16)}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < Math.min(menu.scrollHeight, 240) && above > below;
    menu.style.maxHeight = `${Math.max(0, Math.min(280, upward ? above : below))}px`;
    menu.style.top = `${upward ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6}px`;
  }
  function open() {
    menu.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    position();
    highlight(select.selectedIndex);
  }
  function close() {
    menu.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
  }
  function choose(index) {
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    sync();
    close();
    trigger.focus();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Native light-dismiss runs before click when the trigger is outside the popover.
  let openOnPointerDown = null;
  trigger.addEventListener('pointerdown', () => { openOnPointerDown = isOpen(); });
  trigger.addEventListener('click', () => {
    const shouldClose = openOnPointerDown ?? isOpen();
    openOnPointerDown = null;
    shouldClose ? close() : open();
  });
  trigger.addEventListener('pointercancel', () => { openOnPointerDown = null; });
  trigger.addEventListener('keydown', event => {
    const key = event.key;
    if (key === 'Tab' || key === 'Escape') { close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
      event.preventDefault();
      if (!isOpen()) { open(); return; }
      if (key === 'Enter' || key === ' ') { choose(active); return; }
      highlight(key === 'Home' ? 0 : key === 'End' ? options.length - 1
        : (active + (key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!isOpen()) open();
      const now = Date.now();
      prefix = now - lastTyped > 700 ? key : prefix + key;
      lastTyped = now;
      const index = options.findIndex(item => item.textContent.toLowerCase().startsWith(prefix.toLowerCase()));
      if (index >= 0) highlight(index);
    }
  });
  trigger.addEventListener('blur', close);
  menu.addEventListener('toggle', () => {
    trigger.setAttribute('aria-expanded', String(isOpen()));
    if (!isOpen()) trigger.removeAttribute('aria-activedescendant');
  });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  select.addEventListener('change', sync);
  select.hidden = true;
  label.append(trigger);
  document.body.append(menu);
  sync();
});
