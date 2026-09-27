/* 视频生成长截图 · 页面逻辑：读取视频帧（WebCodecs 或 <video> 逐帧定位）→ 交给 worker.js 拼接 */
(function () {
  'use strict';
  var LIMIT = { maxBytes: 300 * 1024 * 1024, maxSec: 60, minShort: 720, maxShort: 1080, targetFps: 30 };
  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    drop: $('drop'), file: $('file'), pick: $('pick'), upload: $('upload-panel'), work: $('work-panel'), result: $('result-panel'),
    stage: $('stage'), pct: $('pct'), bar: $('bar'), meta: $('meta'), cancel: $('cancel'), err: $('error'), errMsg: $('error-msg'),
    errReset: $('error-reset'), img: $('result-img'), dl: $('download'), again: $('again'), info: $('result-info'), steps: $('steps')
  };
  if (window.Log) { try { Log.setLogLevel(Log.error); Log.error = Log.warn = Log.info = Log.debug = Log.log = function () {}; } catch (e) {} }

  function E(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function mb(b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var job = null;       // current job {aborted, worker, url, ...}

  /* ---------------- UI helpers ---------------- */
  function show(which) {
    ui.upload.hidden = which !== 'upload'; ui.work.hidden = which !== 'work'; ui.result.hidden = which !== 'result';
    ui.err.hidden = which !== 'error';
  }
  var STAGES = [['read', '读取视频'], ['layout', '识别界面'], ['scroll', '计算滚动'], ['stitch', '拼接画面'], ['cursor', '去除鼠标'], ['png', '生成图片']];
  var WEIGHT = { read: 3, layout: 14, scroll: 33, stitch: 22, cursor: 23, png: 5 };
  function setStage(key, frac, extra) {
    var done = 0, i;
    for (i = 0; i < STAGES.length && STAGES[i][0] !== key; i++) done += WEIGHT[STAGES[i][0]];
    var p = Math.min(100, done + WEIGHT[key] * Math.max(0, Math.min(1, frac || 0)));
    ui.bar.style.width = p.toFixed(1) + '%'; ui.pct.textContent = Math.floor(p) + '%';
    var label = ''; for (i = 0; i < STAGES.length; i++) if (STAGES[i][0] === key) label = STAGES[i][1];
    ui.stage.textContent = label + (extra ? ' · ' + extra : '');
    var lis = ui.steps.children;
    for (i = 0; i < lis.length; i++) { var k = lis[i].getAttribute('data-k'), idx = STAGES.findIndex(function (s) { return s[0] === k; }), cur = STAGES.findIndex(function (s) { return s[0] === key; }); lis[i].className = idx < cur ? 'done' : idx === cur ? 'now' : ''; }
  }
  function message(err) {
    var d = err && err.detail || {};
    switch (err && err.code) {
      case 'NOTVIDEO': return '无法识别为视频文件' + (d.name ? '（' + d.name + '）' : '') + '。请选择 MP4 / MOV 等格式的录屏视频。';
      case 'BROKEN': return '这个文件无法作为视频读取' + (d.name ? '（' + d.name + '）' : '') + '，可能已损坏、没有录完，或者其实不是视频。请重新导出 / 录制后再试（推荐 H.264 编码的 MP4）。';
      case 'CODEC': if (/MPEG-4 Part 2/.test(d.codec || '')) return '当前浏览器无法解码这个视频（编码：' + d.codec + '）。这种老式编码常见于 QQ录屏 等软件，浏览器都不支持。推荐改用 Windows 自带录屏：按 Win+Alt+R（Xbox Game Bar，输出 H.264 的 MP4），或使用 OBS 录制；已有的视频也可以用剪映、格式工厂、HandBrake 转成 H.264 MP4 后再上传。';
        return '当前浏览器无法解码这个视频' + (d.codec ? '（编码：' + d.codec + '）' : '') + '。请把视频转成 H.264 编码的 MP4 再试（可用剪映、格式工厂、HandBrake 导出），或用 Windows 自带录屏 Win+Alt+R / OBS 重新录制（默认即 H.264）。';
      case 'TOOBIG': return '文件大小 ' + d.size + ' MB，超过 300 MB 上限。请只录制因子页滚动的那一段（通常 10–30 秒就够），或降低码率后再试。';
      case 'TOOLONG': return '视频时长 ' + d.sec + ' 秒，超过 60 秒上限。请只录制因子页从顶部滑到底部的那一段（通常 10–30 秒）。';
      case 'NODURATION': return '读取不到视频时长，文件可能不完整或已损坏。请重新导出后再试。';
      case 'RES': return '视频分辨率为 ' + d.w + '×' + d.h + '（短边 ' + d.s + ' 像素），本工具仅支持 720p–1080p（短边 720–1080 像素）。请把游戏/录屏分辨率调到 720p–1080p 后重新录制。';
      case 'NOREGION': return '没有在视频里找到上下滚动的列表区域。请确认录制的是「ウマ娘詳細」的因子（継承）页，并在录制过程中上下滑动了列表；录制时尽量不要切换页面或移动窗口。';
      case 'NOSCROLL': return '检测到列表几乎没有滚动（约 ' + (d.px || 0) + ' 像素）。请在录制时把因子列表从顶部一直滑到底部。';
      case 'MEMORY': return '内存不足，处理中断。请关闭其他标签页，或录制更短、分辨率更低（720p）的视频再试。';
      case 'DECODE': return '视频解码中途出错' + (d.msg ? '（' + d.msg + '）' : '') + '。文件可能已损坏，或浏览器不支持该编码。请转成 H.264 MP4 再试。';
      default: return '处理失败' + (err && err.message && err.code !== 'FAIL' ? '（' + err.message + '）' : '') + '。请重试，或换一个视频。';
    }
  }
  function showError(err) { ui.errMsg.textContent = message(err); show('error'); }

  /* ---------------- frame sources ---------------- */
  function isoBmff(file) {
    return file.slice(0, 12).arrayBuffer().then(function (b) { var s = String.fromCharCode.apply(null, new Uint8Array(b).subarray(4, 8)); return s === 'ftyp' || s === 'moov' || s === 'mdat' || s === 'wide' || s === 'free' || s === 'skip'; });
  }
  function descOf(trak) {
    var ents = trak.mdia.minf.stbl.stsd.entries;
    for (var i = 0; i < ents.length; i++) { var b = ents[i].avcC || ents[i].hvcC || ents[i].vpcC || ents[i].av1C; if (b) { var s = new DataStream(undefined, 0, DataStream.BIG_ENDIAN); b.write(s); return new Uint8Array(s.buffer, 8); } }
    return undefined;
  }
  // WebCodecs + mp4box: exact frames, fast. Returns {src} | {codec} (found but not decodable) | null (not MP4).
  function openWebCodecs(file) {
    if (!window.MP4Box) return Promise.resolve(null);
    return isoBmff(file).then(function (iso) {
      if (!iso) return null;
      var mp4 = MP4Box.createFile(), info = null, bad = null;
      mp4.onReady = function (i) { info = i; }; mp4.onError = function (e) { bad = e; };
      var off = 0, CH = 4 * 1024 * 1024, guard = 0;
      function step() {
        if (info || bad || off >= file.size || guard++ > 2000) return Promise.resolve();
        return file.slice(off, off + CH).arrayBuffer().then(function (buf) { buf.fileStart = off; var next = mp4.appendBuffer(buf); off = (typeof next === 'number' && next > off) ? next : off + buf.byteLength; return step(); });
      }
      return step().then(function () {
        try { mp4.flush(); } catch (e) {}
        if (!info) return null;
        var tracks = info.tracks || [], tr = (info.videoTracks && info.videoTracks[0]) || tracks.filter(function (t) { return t.video || /^(avc|hev|hvc|vp0|av01|mp4v)/.test(t.codec || ''); })[0];
        if (!tr) return info.audioTracks && info.audioTracks.length ? { codec: '无视频轨' } : null;
        var trak = mp4.getTrackById(tr.id), samples = trak && trak.samples;
        var codec = tr.codec || '?';
        if (!samples || !samples.length) return null;
        var dur = tr.duration && tr.timescale ? tr.duration / tr.timescale : (info.duration / info.timescale);
        var pw = Math.round((tr.video && tr.video.width) || tr.track_width), ph = Math.round((tr.video && tr.video.height) || tr.track_height);
        var m = tr.matrix || [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824], rot = (Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI) + 360) % 360;
        if (rot % 90) rot = 0;
        var base = { kind: 'webcodecs', codec: codec, W: rot % 180 ? ph : pw, H: rot % 180 ? pw : ph, pw: pw, ph: ph, rot: rot, duration: dur, samples: samples.slice().sort(function (a, b) { return a.dts - b.dts; }), file: file };
        if (!window.VideoDecoder || !window.EncodedVideoChunk) return { codec: codec, meta: base };
        var cfg = { codec: codec, codedWidth: tr.video ? tr.video.width : pw, codedHeight: tr.video ? tr.video.height : ph, description: descOf(trak) };
        return VideoDecoder.isConfigSupported(cfg).then(function (r) {
          if (!r || !r.supported) return { codec: codec, meta: base };
          var fps = base.samples.length / Math.max(0.1, dur); base.step = fps > 36 ? Math.max(2, Math.round(fps / LIMIT.targetFps)) : 1;
          base.n = Math.ceil(base.samples.length / base.step); base.cfg = cfg; base.run = runWebCodecs;
          return { src: base };
        }, function () { return { codec: codec, meta: base }; });
      });
    });
  }
  function drawCtx(W, H) {
    var c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    return c.getContext('2d', { willReadFrequently: true, alpha: false });
  }
  function runWebCodecs(wanted, onFrame) {
    var src = this, ctx = drawCtx(src.W, src.H), inflight = [], outIdx = 0, failure = null;
    var dec = new VideoDecoder({
      output: function (fr) {
        try {
          var k = outIdx++;
          if (k % src.step === 0 && !failure) {
            var idx = k / src.step, rect = wanted(idx);
            if (rect) {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              if (src.rot === 90) ctx.setTransform(0, 1, -1, 0, src.W, 0); else if (src.rot === 180) ctx.setTransform(-1, 0, 0, -1, src.W, src.H); else if (src.rot === 270) ctx.setTransform(0, -1, 1, 0, 0, src.H);
              ctx.drawImage(fr, 0, 0, src.pw, src.ph);
              var img = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
              var pr = onFrame(idx, img, rect); pr.catch(function () {}); inflight.push(pr);
            }
          }
        } catch (e) { failure = failure || e; }
        fr.close();
      },
      error: function (e) { failure = failure || E('DECODE', String(e && e.message || e)); }
    });
    dec.configure(src.cfg);
    var S = src.samples, i = 0, file = src.file;
    function readBatch() {           // read a contiguous byte range covering several samples
      var a = S[i].offset, j = i, end = a;
      while (j < S.length && j - i < 60 && S[j].offset >= a && S[j].offset + S[j].size - a < 16 * 1048576) { end = Math.max(end, S[j].offset + S[j].size); j++; }
      if (j === i) j = i + 1, end = S[i].offset + S[i].size;
      var from = i; i = j;
      return file.slice(a, end).arrayBuffer().then(function (buf) {
        for (var k = from; k < j; k++) { var s = S[k], o = s.offset - a; if (s.offset < a || o + s.size > buf.byteLength) { var e = E('DECODE', 'sample'); throw e; }
          dec.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: Math.round(s.cts * 1e6 / s.timescale), duration: Math.round(s.duration * 1e6 / s.timescale), data: new Uint8Array(buf, o, s.size) })); }
      });
    }
    function pump() {
      if (failure) return Promise.reject(failure);
      if (job && job.aborted) return Promise.reject(E('ABORT'));
      if (inflight.length > 3) return inflight.shift().then(pump);
      if (dec.decodeQueueSize > 12) return sleep(2).then(pump);
      if (i >= S.length) return dec.flush().then(function () { return Promise.all(inflight); }).then(function () { if (failure) throw failure; });
      return readBatch().then(pump);
    }
    return pump().then(function (r) { try { dec.close(); } catch (e) {} return r; }, function (e) { try { dec.close(); } catch (x) {} throw e; });
  }
  // Fallback: <video> element, seek frame by frame at ~30 fps.
  function openVideoElement(file) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
      var to = setTimeout(function () { fin(E('NOTVIDEO')); }, 20000);
      function fin(err, failed) { if (done) return; done = true; clearTimeout(to); if (err) { v.onerror = null; if (!failed) { v.removeAttribute('src'); try { v.load(); } catch (e) {} } setTimeout(function () { URL.revokeObjectURL(url); }, 1000); reject(err); } }
      v.onerror = function () { var code = v.error && v.error.code; fin(code === 4 && /^video\//.test(file.type) ? E('CODEC') : code === 4 ? E('NOTVIDEO') : E('DECODE', v.error && v.error.message), true); };
      v.onloadeddata = function () {
        if (done) return;
        if (!v.videoWidth || !v.videoHeight) return fin(E('CODEC'));
        var ready = isFinite(v.duration) && v.duration > 0 ? Promise.resolve() : new Promise(function (r) { v.ondurationchange = function () { if (isFinite(v.duration)) r(); }; v.currentTime = 1e7; setTimeout(r, 4000); });
        ready.then(function () {
          if (!isFinite(v.duration) || !(v.duration > 0)) return fin(E('NODURATION'));
          done = true; clearTimeout(to);
          var n = Math.max(1, Math.floor(v.duration * LIMIT.targetFps));
          resolve({ kind: 'video', W: v.videoWidth, H: v.videoHeight, duration: v.duration, n: n, video: v, url: url, run: runVideoElement });
        });
      };
      v.src = url;
    });
  }
  function seek(v, t) {
    return new Promise(function (resolve, reject) {
      var to = setTimeout(function () { v.onseeked = null; reject(E('DECODE', 'seek timeout')); }, 15000);
      v.onseeked = function () { clearTimeout(to); v.onseeked = null; resolve(); };
      v.currentTime = t;
    });
  }
  function runVideoElement(wanted, onFrame) {
    var src = this, v = src.video, ctx = drawCtx(src.W, src.H), i = 0, inflight = [];
    function next() {
      if (job && job.aborted) return Promise.reject(E('ABORT'));
      while (i < src.n && !wanted(i)) i++;
      if (i >= src.n) return Promise.all(inflight);
      var idx = i++, rect = wanted(idx), t = Math.min(src.duration - 0.005, (idx + 0.5) / LIMIT.targetFps);
      return seek(v, t).then(function () {
        ctx.drawImage(v, 0, 0, src.W, src.H);
        var pr = onFrame(idx, ctx.getImageData(rect.x, rect.y, rect.w, rect.h), rect); pr.catch(function () {}); inflight.push(pr);
        return inflight.length > 2 ? inflight.shift().then(next) : next();
      });
    }
    return next();
  }

  /* ---------------- worker RPC ---------------- */
  function makeWorker() {
    var w = new Worker('worker.js'), seq = 0, pend = {};
    w.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'progress') return;
      if (m.type === 'result') { var p = pend.result; delete pend.result; if (p) p.res(m); return; }
      var q = pend[m.id]; if (!q) return; delete pend[m.id];
      if (m.type === 'error') { var err = E(m.code, m.message); err.detail = m.detail; q.rej(err); } else q.res(m);
    };
    w.onerror = function (e) { e.preventDefault && e.preventDefault(); var err = E('FAIL', 'worker'); Object.keys(pend).forEach(function (k) { pend[k].rej(err); }); pend = {}; };
    return {
      call: function (type, extra, transfer) { var id = ++seq; return new Promise(function (res, rej) { pend[id] = { res: res, rej: rej }; w.postMessage(Object.assign({ type: type, id: id }, extra || {}), transfer || []); }); },
      finish: function () { return new Promise(function (res, rej) { pend.result = { res: res, rej: rej }; var id = ++seq; pend[id] = { res: function () {}, rej: rej }; w.postMessage({ type: 'finish', id: id }); }); },
      kill: function () { w.terminate(); }
    };
  }

  /* ---------------- pipeline ---------------- */
  function cleanup() {
    if (!job) return;
    job.aborted = true;
    if (job.worker) job.worker.kill();
    if (job.src && job.src.url) { URL.revokeObjectURL(job.src.url); try { job.src.video.removeAttribute('src'); job.src.video.load(); } catch (e) {} }
    job = null;
  }
  function start(file) {
    cleanup();
    if (ui.img.src && ui.img.src.indexOf('blob:') === 0) URL.revokeObjectURL(ui.img.src);
    ui.img.removeAttribute('src');
    var me = job = { aborted: false, t0: Date.now() };
    show('work'); setStage('read', 0); ui.meta.textContent = file.name + ' · ' + mb(file.size) + ' MB';
    run(file, me).then(function () {}, function (err) {
      if (me.aborted && (!err || err.code === 'ABORT')) return;
      if (job !== me) return;
      cleanup(); showError(err);
    });
  }
  function run(file, me) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var videoExt = ['mp4', 'mov', 'm4v', 'webm', 'mkv', '3gp', 'avi', 'ts', 'm2ts', 'flv', 'wmv', 'hevc', 'qt'];
    if (!/^video\//.test(file.type) && videoExt.indexOf(ext) < 0) return Promise.reject(Object.assign(E('NOTVIDEO'), { detail: { name: file.name } }));
    if (file.size > LIMIT.maxBytes) return Promise.reject(Object.assign(E('TOOBIG'), { detail: { size: mb(file.size) } }));
    if (!file.size) return Promise.reject(Object.assign(E('NOTVIDEO'), { detail: { name: file.name } }));
    var codecSeen = null, src, W, n, L, rect, isoLike = /^(mp4|mov|m4v|qt|3gp)$/.test(ext) || /^video\/(mp4|quicktime|3gpp)/.test(file.type);
    return openWebCodecs(file).catch(function () { return null; }).then(function (r) {
      if (r && r.src) return r.src;
      if (r && r.codec) codecSeen = r.codec;
      if (codecSeen && /^[a-z0-9]{4}\./i.test(codecSeen) && !document.createElement('video').canPlayType('video/mp4; codecs="' + codecSeen + '"')) throw Object.assign(E('CODEC'), { detail: { codec: prettyCodec(codecSeen) } });
      return openVideoElement(file).catch(function (e) {
        if (codecSeen && (e.code === 'CODEC' || e.code === 'NOTVIDEO' || e.code === 'DECODE')) throw Object.assign(E('CODEC'), { detail: { codec: prettyCodec(codecSeen) } });
        if (!r && isoLike && (e.code === 'CODEC' || e.code === 'NOTVIDEO')) throw Object.assign(E('BROKEN'), { detail: { name: file.name } });
        if (e.code === 'NOTVIDEO') e.detail = { name: file.name };
        throw e;
      });
    }).then(function (s) {
      if (me.aborted) throw E('ABORT');
      src = me.src = s; W = s.W; n = s.n;
      var sec = s.duration, shortSide = Math.min(s.W, s.H);
      if (!(sec > 0)) throw E('NODURATION');
      if (sec > LIMIT.maxSec + 0.5) throw Object.assign(E('TOOLONG'), { detail: { sec: sec.toFixed(1) } });
      if (shortSide < LIMIT.minShort || shortSide > LIMIT.maxShort) throw Object.assign(E('RES'), { detail: { w: s.W, h: s.H, s: shortSide } });
      ui.meta.textContent = file.name + ' · ' + s.W + '×' + s.H + ' · ' + sec.toFixed(1) + ' 秒 · ' + mb(file.size) + ' MB';
      me.worker = makeWorker();
      return me.worker.call('init', { W: s.W, H: s.H, n: n });
    }).then(function () {
      // pass 0: layout samples
      var sStd = Math.max(1, Math.floor(n / 80)), sMed = Math.max(1, Math.floor(n / 15)), full = { x: 0, y: 0, w: src.W, h: src.H }, cnt = 0, tot = Math.ceil(n / sStd) + Math.ceil(n / sMed);
      setStage('layout', 0);
      return src.run(function (i) { return (i % sStd === 0 || i % sMed === 0) ? full : null; }, function (i, img) {
        cnt += (i % sStd === 0) + (i % sMed === 0); setStage('layout', cnt / tot * 0.8);
        return me.worker.call('p0', { data: img.data.buffer, std: i % sStd === 0, med: i % sMed === 0 }, [img.data.buffer]);
      });
    }).then(function () { return me.worker.call('layout'); }).then(function (r) {
      L = r.L; var rx = Math.min(L.x0, L.c0);
      var r1 = { x: rx, y: L.y0, w: Math.max(L.x1, L.cw) - rx, h: L.v1 - L.y0 };
      setStage('scroll', 0);
      return src.run(function () { return r1; }, function (i, img, rc) {
        if (i % 4 === 0) setStage('scroll', i / n);
        return me.worker.call('p1', { idx: i, data: img.data.buffer, rect: rc }, [img.data.buffer]);
      });
    }).then(function () { return me.worker.call('plan'); }).then(function (pl) {
      me.plan = pl;
      var need = new Set(pl.frames), strip = { x: L.x0, y: L.v0, w: L.x1 - L.x0, h: L.v1 - L.v0 }, head = { x: L.x0, y: L.y0, w: L.x1 - L.x0, h: L.v1 - L.y0 }, c = 0;
      rect = strip;
      setStage('stitch', 0);
      return src.run(function (i) { return need.has(i) ? (i === pl.headerFrame ? head : strip) : null; }, function (i, img, rc) {
        setStage('stitch', ++c / need.size * 0.85);
        return me.worker.call('p2', { idx: i, data: img.data.buffer, rect: rc }, [img.data.buffer]);
      });
    }).then(function () { setStage('stitch', 0.9); return me.worker.call('p3start'); }).then(function (r) {
      var need = new Set(r.frames), c = 0; setStage('cursor', 0);
      return src.run(function (i) { return need.has(i) ? rect : null; }, function (i, img, rc) {
        setStage('cursor', ++c / need.size * 0.55);
        return me.worker.call('p3', { idx: i, data: img.data.buffer, rect: rc }, [img.data.buffer]);
      });
    }).then(function () { return me.worker.call('p3done'); }).then(function (r) {
      var need = new Set(r.frames), c = 0;
      if (!need.size) return;
      return src.run(function (i) { return need.has(i) ? rect : null; }, function (i, img, rc) {
        setStage('cursor', 0.55 + ++c / need.size * 0.35);
        return me.worker.call('p4', { idx: i, data: img.data.buffer, rect: rc }, [img.data.buffer]);
      });
    }).then(function () { return me.worker.call('p5plan'); }).then(function (r) {
      var need = new Set(r.frames || []), c = 0;
      if (!need.size) return;
      return src.run(function (i) { return need.has(i) ? rect : null; }, function (i, img, rc) {
        setStage('cursor', 0.9 + ++c / need.size * 0.1);
        return me.worker.call('p5', { idx: i, data: img.data.buffer, rect: rc }, [img.data.buffer]);
      });
    }).then(function () { setStage('png', 0.1); return me.worker.finish(); }).then(function (m) {
      if (me.aborted) throw E('ABORT');
      me.worker.kill(); me.worker = null;
      var c = document.createElement('canvas'); c.width = m.w; c.height = m.h;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.data), m.w, m.h), 0, 0);
      setStage('png', 0.5);
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res({ blob: b, m: m }) : rej(E('MEMORY')); }, 'image/png'); });
    }).then(function (o) {
      if (me.aborted) throw E('ABORT');
      var url = URL.createObjectURL(o.blob), base = file.name.replace(/\.[^.]+$/, '') || 'longshot';
      ui.img.src = url; ui.img.width = o.m.w; ui.img.height = o.m.h;
      ui.dl.href = url; ui.dl.download = base + '_长截图.png';
      var secs = ((Date.now() - me.t0) / 1000).toFixed(1);
      ui.info.textContent = o.m.w + ' × ' + o.m.h + ' 像素 · ' + mb(o.blob.size) + ' MB · 滚动 ' + o.m.info.scroll + ' 像素 · 用时 ' + secs + ' 秒' + (o.m.info.cursor ? ' · 已去除鼠标指针' : '');
      window.__longshot = { w: o.m.w, h: o.m.h, bytes: o.blob.size, info: o.m.info, secs: +secs, source: src.kind };
      if (src.url) { URL.revokeObjectURL(src.url); src.url = null; }
      job = null; show('result');
    });
  }
  function prettyCodec(c) {
    c = String(c || '');
    if (/^(hev1|hvc1)/.test(c)) return 'HEVC / H.265';
    if (/^avc/.test(c)) return 'H.264（' + c + '）';
    if (/^mp4v/.test(c)) return 'MPEG-4 Part 2（' + c + '）';
    if (/^av01/.test(c)) return 'AV1';
    if (/^vp09/.test(c)) return 'VP9';
    return c;
  }

  /* ---------------- events ---------------- */
  function pickFile(files) { if (files && files[0]) start(files[0]); }
  ui.pick.addEventListener('click', function (e) { e.stopPropagation(); ui.file.click(); });
  ui.drop.addEventListener('click', function () { ui.file.click(); });
  ui.drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.file.click(); } });
  ui.file.addEventListener('change', function () { var f = ui.file.files; pickFile(f); ui.file.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) { ui.drop.addEventListener(t, function (e) { e.preventDefault(); ui.drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { ui.drop.addEventListener(t, function (e) { e.preventDefault(); ui.drop.classList.remove('over'); }); });
  ui.drop.addEventListener('drop', function (e) { pickFile(e.dataTransfer && e.dataTransfer.files); });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });
  function reset() { cleanup(); show('upload'); }
  ui.cancel.addEventListener('click', reset);
  ui.errReset.addEventListener('click', reset);
  ui.again.addEventListener('click', reset);
  window.__longshotStart = start;
})();
