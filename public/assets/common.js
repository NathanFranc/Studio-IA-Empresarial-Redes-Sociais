/* Funções compartilhadas pelas páginas: chamadas à API, barra do topo e avisos. */
(function () {
  /** Chama a API do Estúdio. Lança Error com a mensagem pronta para mostrar. */
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'estudio' }, signal: opts.signal, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new Error('Sem conexão com o servidor. Confira a internet e tente de novo.');
    }
    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
      location.href = '/login';
      throw new Error('Sua sessão expirou.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Algo deu errado. Tente de novo.');
    return data;
  }

  /** Registra um evento do navegador (download, cópia de legenda) sem travar a tela. */
  function logEvent(action, detail, postId) {
    api('/api/events', { method: 'POST', body: { action, detail, postId } }).catch(() => {});
  }

  /** Baixa um Blob com o nome indicado. */
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Monta a barra do topo com o usuário logado. */
  async function mountTopbar(active) {
    const bar = document.getElementById('topbar');
    if (!bar) return null;
    let me;
    try {
      me = (await api('/api/auth/me')).user;
    } catch {
      return null;
    }
    const links = [['/', 'Estúdio', 'estudio']];
    if (me.role === 'admin') links.push(['/admin', 'Administração', 'admin']);
    links.push(['/conta', 'Minha conta', 'conta']);
    bar.innerHTML = '';
    const brand = document.createElement('a');
    brand.href = '/';
    brand.className = 'tb-brand';
    brand.innerHTML = '<img src="/assets/megadino-logo-preta.png" alt="Megadino" class="tb-logo-l"><img src="/assets/megadino-logo-branca.png" alt="" class="tb-logo-d"><span>Estúdio</span>';
    const nav = document.createElement('nav');
    for (const [href, label, key] of links) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      if (key === active) a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
    const who = document.createElement('span');
    who.className = 'tb-user';
    who.textContent = me.name + (me.role === 'admin' ? ' · admin' : '');
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'tb-out';
    out.textContent = 'Sair';
    out.onclick = async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/login';
    };
    bar.append(brand, nav, who, out);
    if (me.mustChange && active !== 'conta') location.href = '/conta?primeiro=1';
    return me;
  }

  const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  /** Datas do banco vêm em UTC ("2026-09-30 18:10:00"); mostra no horário de Brasília. */
  function fmtDate(s) {
    if (!s) return '—';
    return fmt.format(new Date(s.replace(' ', 'T') + 'Z'));
  }

  window.Estudio = { api, logEvent, downloadBlob, mountTopbar, fmtDate };
})();
