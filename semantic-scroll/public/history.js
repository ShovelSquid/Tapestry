/* Semantic Scroll deterministic history layer.
   Stores append-only events plus periodic scene checkpoints in localStorage.
   Visual particles are intentionally excluded: replay restores semantic state,
   geometry, model location, links and text, not frame-timing-dependent decoration. */
(() => {
  const STORAGE_KEY = 'semantic-scroll-history-v1';
  const SESSION_KEY = 'semantic-scroll-session-v1';
  const MAX_EVENTS = 12000;
  const MAX_CHECKPOINTS = 120;

  const clone = value => JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();

  class SemanticHistory {
    constructor() {
      this.data = this.load();
      this.listeners = new Set();
      this.snapshotProvider = null;
      this.replayHandler = null;
      this.timer = null;
      this.timerMinutes = this.data.settings?.timerMinutes ?? 5;
      this.significanceThreshold = this.data.settings?.significanceThreshold ?? 3;
      this.pendingSignificance = 0;
      this.lastCheckpointEventId = this.data.checkpoints.at(-1)?.eventId ?? 0;
    }

    load() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (parsed?.version === 1 && Array.isArray(parsed.events)) return parsed;
      } catch {}
      return {
        version: 1,
        sessionId: sessionStorage.getItem(SESSION_KEY) || crypto.randomUUID(),
        createdAt: nowIso(),
        nextEventId: 1,
        events: [],
        checkpoints: [],
        settings: {timerMinutes: 5, significanceThreshold: 3}
      };
    }

    save() {
      this.data.settings = {
        timerMinutes: this.timerMinutes,
        significanceThreshold: this.significanceThreshold
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      sessionStorage.setItem(SESSION_KEY, this.data.sessionId);
      this.emit();
    }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { for (const fn of this.listeners) fn(this.summary()); }
    summary() {
      return {
        events: this.data.events.length,
        checkpoints: this.data.checkpoints.length,
        latest: this.data.events.at(-1) || null,
        pendingSignificance: this.pendingSignificance,
        timerMinutes: this.timerMinutes
      };
    }

    setSnapshotProvider(fn) { this.snapshotProvider = fn; }
    setReplayHandler(fn) { this.replayHandler = fn; }

    record(type, payload = {}, options = {}) {
      if (window.__SEMANTIC_REPLAYING__) return null;
      const event = {
        id: this.data.nextEventId++,
        sessionId: this.data.sessionId,
        at: nowIso(),
        perfMs: Math.round(performance.now() * 1000) / 1000,
        type,
        actor: options.actor || 'human',
        where: options.where || null,
        why: options.why || null,
        significant: options.significant !== false,
        payload: clone(payload)
      };
      this.data.events.push(event);
      if (this.data.events.length > MAX_EVENTS) this.data.events.splice(0, this.data.events.length - MAX_EVENTS);
      if (event.significant) this.pendingSignificance++;
      this.save();

      if (options.checkpoint || this.pendingSignificance >= this.significanceThreshold) {
        queueMicrotask(() => this.checkpoint(options.reason || `significant:${type}`, {createUpdate: true}));
      }
      return event;
    }

    checkpoint(reason = 'manual', {createUpdate = false} = {}) {
      if (!this.snapshotProvider || window.__SEMANTIC_REPLAYING__) return null;
      const snapshot = this.snapshotProvider();
      const latest = this.data.events.at(-1);
      const checkpoint = {
        id: crypto.randomUUID(),
        at: nowIso(),
        reason,
        eventId: latest?.id ?? 0,
        state: clone(snapshot)
      };
      this.data.checkpoints.push(checkpoint);
      if (this.data.checkpoints.length > MAX_CHECKPOINTS)
        this.data.checkpoints.splice(0, this.data.checkpoints.length - MAX_CHECKPOINTS);
      this.pendingSignificance = 0;
      this.lastCheckpointEventId = checkpoint.eventId;
      this.save();
      dispatchEvent(new CustomEvent('semantic-checkpoint', {detail:{checkpoint, createUpdate}}));
      return checkpoint;
    }

    startTimer(minutes = this.timerMinutes) {
      this.stopTimer();
      this.timerMinutes = Math.max(0, Number(minutes) || 0);
      this.save();
      if (!this.timerMinutes) return;
      this.timer = setInterval(() => {
        this.record('timer.elapsed', {minutes:this.timerMinutes}, {
          actor:'system', why:'Periodic continuity checkpoint', significant:false
        });
        this.checkpoint(`timer:${this.timerMinutes}m`, {createUpdate:true});
      }, this.timerMinutes * 60_000);
    }

    stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }

    eventsSince(eventId = 0) { return this.data.events.filter(e => e.id > eventId); }

    updateNarrative(checkpoint) {
      const previous = this.data.checkpoints.at(-2);
      const from = previous?.eventId ?? 0;
      const events = this.eventsSince(from).filter(e => e.id <= checkpoint.eventId);
      const byType = new Map();
      for (const e of events) byType.set(e.type, (byType.get(e.type) || 0) + 1);
      const changes = [...byType.entries()].map(([k,v]) => `${v}× ${k}`).join(', ') || 'No semantic mutations';
      const reasons = [...new Set(events.map(e => e.why).filter(Boolean))].slice(0,4);
      const places = [...new Set(events.map(e => e.where).filter(Boolean).map(w => typeof w === 'string' ? w : JSON.stringify(w)))].slice(0,4);
      return {
        title: `Update · ${new Date(checkpoint.at).toLocaleString()}`,
        text: [
          `What changed: ${changes}.`,
          `When: ${checkpoint.at}.`,
          `Why: ${reasons.length ? reasons.join('; ') : checkpoint.reason}.`,
          `Where: ${places.length ? places.join('; ') : 'Across the semantic scene'}.`,
          `Replay boundary: event ${from + 1} → ${checkpoint.eventId}.`
        ].join('\n\n'),
        eventIds: events.map(e => e.id)
      };
    }

    exportBlob() {
      return new Blob([JSON.stringify(this.data, null, 2)], {type:'application/json'});
    }

    importData(data) {
      if (!data || data.version !== 1 || !Array.isArray(data.events) || !Array.isArray(data.checkpoints))
        throw new Error('Not a Semantic Scroll history v1 file.');
      this.data = data;
      this.timerMinutes = data.settings?.timerMinutes ?? 5;
      this.significanceThreshold = data.settings?.significanceThreshold ?? 3;
      this.save();
    }

    replayCheckpoint(id) {
      const cp = this.data.checkpoints.find(c => c.id === id) || this.data.checkpoints.at(-1);
      if (!cp || !this.replayHandler) return false;
      window.__SEMANTIC_REPLAYING__ = true;
      try { this.replayHandler(clone(cp.state), cp); }
      finally { window.__SEMANTIC_REPLAYING__ = false; }
      this.emit();
      return true;
    }

    clear() {
      this.stopTimer();
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      this.data = this.load();
      this.pendingSignificance = 0;
      this.save();
    }
  }

  window.semanticHistory = new SemanticHistory();
})();
