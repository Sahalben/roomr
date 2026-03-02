/* ============================================================
   ROOMR — Core Engine v2
   LocalStorage persistence + BroadcastChannel real-time sync
   ============================================================ */

const ROOMR = (() => {

  /* ─── Storage ─── */
  const S = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    del: k => localStorage.removeItem(k),
  };

  /* ─── Utils ─── */
  const uid = (len = 10) => Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b => b.toString(36)).join('').toUpperCase().slice(0, len);

  const codeGen = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  const now = () => Date.now();

  const fmtTime = ms => {
    if (ms <= 0) return '00:00';
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60),
          h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${String(h % 24).padStart(2,'0')}h`;
    if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  };

  const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB';

  const fmtDate = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const fileIcon = name => {
    if (!name) return '📄';
    const ext = name.split('.').pop().toLowerCase();
    const m = { pdf:'pdf',doc:'doc',docx:'doc',txt:'txt',md:'txt',
      jpg:'img',jpeg:'img',png:'img',gif:'img',svg:'svg',webp:'img',
      mp4:'vid',mov:'vid',avi:'vid',mkv:'vid',mp3:'aud',wav:'aud',
      zip:'zip',rar:'zip',tar:'zip',gz:'zip',
      js:'code',ts:'code',py:'code',html:'code',css:'code',json:'code',
      xls:'xls',xlsx:'xls',csv:'xls',ppt:'ppt',pptx:'ppt',
    };
    const icons = { pdf:'📕',doc:'📝',txt:'📃',img:'🖼️',svg:'🎨',vid:'🎬',aud:'🎵',zip:'📦',code:'💻',xls:'📊',ppt:'📉' };
    return icons[m[ext]] || '📄';
  };

  const escHtml = s => String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const initials = name => name ? name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0,2) : '??';

  const avatarColor = name => {
    const palette = ['#00c896','#00a8ff','#7b61ff','#ff6b6b','#ffa502','#2ed573','#ff4757','#1e90ff'];
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return palette[Math.abs(h) % palette.length];
  };

  /* ─── Auth ─── */
  const auth = {
    register(name, email, password) {
      const users = S.get('rr:users') || {};
      if (users[email]) return { ok: false, error: 'Email already registered.' };
      const user = { id: uid(), name: name.trim(), email: email.trim().toLowerCase(), password, createdAt: now(), avatar: initials(name) };
      users[email] = user;
      S.set('rr:users', users);
      return { ok: true, user };
    },
    login(email, password) {
      const users = S.get('rr:users') || {};
      const user = users[email.trim().toLowerCase()];
      if (!user) return { ok: false, error: 'No account with that email.' };
      if (user.password !== password) return { ok: false, error: 'Incorrect password.' };
      S.set('rr:session', user);
      return { ok: true, user };
    },
    logout() { S.del('rr:session'); location.href = '../index.html'; },
    me: () => S.get('rr:session'),
    require(fallback = '../pages/signin.html') {
      const u = S.get('rr:session');
      if (!u) { location.href = fallback; return null; }
      return u;
    },
    updateName(newName) {
      const me = S.get('rr:session');
      if (!me) return;
      me.name = newName; me.avatar = initials(newName);
      S.set('rr:session', me);
      // update in users store
      const users = S.get('rr:users') || {};
      if (users[me.email]) { users[me.email] = { ...users[me.email], name: newName, avatar: initials(newName) }; S.set('rr:users', users); }
    }
  };

  /* ─── Rooms ─── */
  const rooms = {
    _all: () => S.get('rr:rooms') || {},
    _save: data => S.set('rr:rooms', data),

    get: id => { const a = S.get('rr:rooms') || {}; return a[id] || null; },

    byCode(code) {
      const all = rooms._all();
      return Object.values(all).find(r => r.code === code.toUpperCase()) || null;
    },

    create(name, durationMs, opts, creator) {
      const all = rooms._all();
      const id = uid();
      const room = {
        id, code: codeGen(), name: name.trim(),
        createdAt: now(), expiresAt: now() + durationMs, durationMs,
        creatorId: creator.id, creatorName: creator.name,
        members: [{ id: creator.id, name: creator.name, role: 'admin', joinedAt: now(), online: true }],
        permissions: {
          membersCanUpload: opts.membersCanUpload ?? true,
          membersCanDelete: opts.membersCanDelete ?? false,
          membersCanChat: opts.membersCanChat ?? true,
          membersCanCreateFolders: opts.membersCanCreateFolders ?? false,
        },
        files: [],
        folders: [],
        messages: [],
        description: opts.description || '',
      };
      all[id] = room;
      rooms._save(all);
      return room;
    },

    update(id, patch) {
      const all = rooms._all();
      if (!all[id]) return null;
      all[id] = { ...all[id], ...patch };
      rooms._save(all);
      return all[id];
    },

    delete(id) {
      const all = rooms._all();
      delete all[id];
      rooms._save(all);
    },

    join(code, user) {
      const all = rooms._all();
      const room = Object.values(all).find(r => r.code === code.toUpperCase());
      if (!room) return { ok: false, error: 'Room not found. Check the code and try again.' };
      if (Date.now() > room.expiresAt) return { ok: false, error: 'This room has expired.' };
      const existing = room.members.find(m => m.id === user.id);
      if (!existing) {
        room.members.push({ id: user.id, name: user.name, role: 'member', joinedAt: now(), online: true });
        all[room.id] = room;
        rooms._save(all);
      }
      return { ok: true, room };
    },

    isExpired: r => !r || Date.now() > r.expiresAt,
    timeLeft: r => r ? Math.max(0, r.expiresAt - Date.now()) : 0,
    progress: r => r ? Math.max(0, Math.min(100, (rooms.timeLeft(r) / r.durationMs) * 100)) : 0,

    forUser(userId) {
      return Object.values(rooms._all()).filter(r => r.members.some(m => m.id === userId));
    },

    /* Messages */
    addMsg(roomId, msg) {
      const all = rooms._all();
      if (!all[roomId]) return;
      all[roomId].messages.push(msg);
      rooms._save(all);
      bc.send(roomId, 'msg', msg);
    },

    /* Files */
    addFile(roomId, file) {
      const all = rooms._all();
      if (!all[roomId]) return null;
      all[roomId].files.push(file);
      rooms._save(all);
      bc.send(roomId, 'file_add', { id: file.id, name: file.name, size: file.size, folderId: file.folderId, uploadedBy: file.uploadedByName, ts: file.ts });
      return file;
    },

    deleteFile(roomId, fileId) {
      const all = rooms._all();
      if (!all[roomId]) return;
      all[roomId].files = all[roomId].files.filter(f => f.id !== fileId);
      rooms._save(all);
      bc.send(roomId, 'file_del', { id: fileId });
    },

    addFolder(roomId, name, parentId) {
      const all = rooms._all();
      if (!all[roomId]) return null;
      const folder = { id: uid(), name: name.trim(), parentId: parentId || null, createdAt: now() };
      all[roomId].folders.push(folder);
      rooms._save(all);
      bc.send(roomId, 'folder_add', folder);
      return folder;
    },

    deleteFolder(roomId, folderId) {
      const all = rooms._all();
      if (!all[roomId]) return;
      // recursively gather child folder ids
      const getDescendants = id => {
        const children = all[roomId].folders.filter(f => f.parentId === id);
        return [id, ...children.flatMap(c => getDescendants(c.id))];
      };
      const toDelete = new Set(getDescendants(folderId));
      all[roomId].folders = all[roomId].folders.filter(f => !toDelete.has(f.id));
      all[roomId].files = all[roomId].files.filter(f => !toDelete.has(f.folderId));
      rooms._save(all);
    },

    extend(roomId, ms) {
      const all = rooms._all();
      if (!all[roomId]) return;
      all[roomId].expiresAt += ms;
      all[roomId].durationMs += ms;
      rooms._save(all);
      bc.send(roomId, 'room_update', { expiresAt: all[roomId].expiresAt });
    },

    kill(roomId) {
      const all = rooms._all();
      if (!all[roomId]) return;
      all[roomId].expiresAt = Date.now() - 1;
      rooms._save(all);
      bc.send(roomId, 'room_killed', {});
    },

    updatePerms(roomId, perms) {
      const all = rooms._all();
      if (!all[roomId]) return;
      all[roomId].permissions = { ...all[roomId].permissions, ...perms };
      rooms._save(all);
      bc.send(roomId, 'perms_update', all[roomId].permissions);
    }
  };

  /* ─── BroadcastChannel (cross-tab real-time) ─── */
  const bc = {
    channels: {},
    send(roomId, type, data) {
      try {
        const ch = new BroadcastChannel('rr:' + roomId);
        ch.postMessage({ type, data, ts: now() });
        ch.close();
      } catch {}
    },
    listen(roomId, handler) {
      try {
        const ch = new BroadcastChannel('rr:' + roomId);
        ch.onmessage = e => handler(e.data);
        bc.channels[roomId] = ch;
        return ch;
      } catch { return null; }
    },
    unlisten(roomId) {
      try { bc.channels[roomId]?.close(); delete bc.channels[roomId]; } catch {}
    }
  };

  /* ─── Toast ─── */
  let toastTimer;
  const toast = (msg, type = 'success', duration = 3500) => {
    let el = document.getElementById('rr-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rr-toast';
      el.style.cssText = 'position:fixed;bottom:28px;right:28px;z-index:9999;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);transform:translateY(80px);opacity:0;transition:all .3s cubic-bezier(.34,1.56,.64,1);pointer-events:none;backdrop-filter:blur(16px);border:1px solid;max-width:340px;font-family:var(--font-ui);';
      document.body.appendChild(el);
    }
    const icons = { success:'✓', error:'✕', info:'ℹ', warning:'⚠' };
    const colors = { success:'rgba(0,200,150,.15)', error:'rgba(255,71,87,.15)', info:'rgba(0,168,255,.15)', warning:'rgba(255,165,2,.15)' };
    const borders = { success:'rgba(0,200,150,.3)', error:'rgba(255,71,87,.3)', info:'rgba(0,168,255,.3)', warning:'rgba(255,165,2,.3)' };
    const textColors = { success:'#00c896', error:'#ff4757', info:'#00a8ff', warning:'#ffa502' };
    el.style.background = colors[type];
    el.style.borderColor = borders[type];
    el.style.color = '#f0f0f0';
    el.innerHTML = `<span style="color:${textColors[type]};font-size:15px;font-weight:700;">${icons[type]}</span>${escHtml(msg)}`;
    el.style.transform = 'translateY(0)'; el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.transform = 'translateY(80px)'; el.style.opacity = '0'; }, duration);
  };

  /* ─── Modal ─── */
  const modal = {
    show: id => document.getElementById(id)?.classList.add('open'),
    hide: id => document.getElementById(id)?.classList.remove('open'),
    init() {
      document.addEventListener('click', e => {
        if (e.target.classList.contains('modal-backdrop')) {
          e.target.classList.remove('open');
        }
      });
    }
  };

  return { auth, rooms, bc, toast, modal, uid, codeGen, now, fmtTime, fmtSize, fmtDate, fileIcon, escHtml, initials, avatarColor };
})();
