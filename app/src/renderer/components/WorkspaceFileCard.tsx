/**
 * WorkspaceFileCard — a workspace file as a card, and as an editable window
 * (02.7 D-02, D-04, D-05).
 *
 * Collapsed, a text file shows its first lines (the lazy body: ~740 cards on
 * one canvas stay cheap). Opened, it becomes a 720px window with the file's
 * whole text in a textarea. Typing is written to the file about a second after
 * it pauses, through `workspace:saveFile`; main records the edit as the
 * person, then writes it only if the file still says what the window started
 * from. When the file changed first, the file wins: the window shows the
 * file's text, and the edit stays in history.
 *
 * The window keeps its keys, pointer and wheel to itself, so Backspace never
 * deletes the note, Cmd+Z never rewinds the tree, and scrolling the text never
 * pans the canvas.
 *
 * Non-text files (binary, too large, symlinks) show only name, type and size.
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { NodeInfo } from './Canvas'
import ProvenanceBadge, { actorSpokenText } from './ProvenanceBadge'
import { AskClaudeButton, useContextMenu } from './ContextMenu'
import { ChatContext } from '../state/chat'

export const WORKSPACE_SAVE_DEBOUNCE_MS = 1000

const TEXT_TYPE = 'tapestry.workspace/text@1'
const PREVIEW_LINES = 8
const OPEN_WIDTH = 720
const MAX_TEXTAREA_HEIGHT = 560
const DESTRUCTIVE = '#B3261E'
const MUTED = '#6B6760'

interface WorkspaceFileCardProps {
  treeId: string
  node: NodeInfo
  isSelected: boolean
  zoom: number
  provenance?: TapestryNodeHistory
  onBorderSelect: () => void
  onHover: (hovered: boolean) => void
  onPositionChange: (nodeId: string, x: number, y: number) => void
  onRegisterDims: (id: string, width: number, height: number) => void
  onDragMove?: (nodeId: string, x: number, y: number) => void
  onDragEnd?: (nodeId: string) => void
  /**
   * A request to open this card's window (open_file, 02.7 SC2). Each new
   * value opens it once, including on a card that mounts with it because a
   * reveal just expanded its folder.
   */
  openNonce?: number
}

/** Open requests already acted on, so a remounted card does not reopen. */
const consumedOpenNonces = new Set<number>()

function propString(node: NodeInfo, key: string, fallback = ''): string {
  const prop = node.props[key]
  return prop && typeof prop.value === 'string' ? prop.value : fallback
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

type LineEndings = 'lf' | 'crlf' | 'mixed'

/** How a file ends its lines, so editing never changes bytes it did not mean to. */
function lineEndingsOf(text: string): LineEndings {
  if (!text.includes('\r')) return 'lf'
  const crlf = text.split('\r\n').length - 1
  const lf = text.split('\n').length - 1
  const cr = text.split('\r').length - 1
  return crlf === lf && cr === crlf ? 'crlf' : 'mixed'
}

function forEditing(text: string, endings: LineEndings): string {
  return endings === 'crlf' ? text.replace(/\r\n/g, '\n') : text
}

function forDisk(text: string, endings: LineEndings): string {
  return endings === 'crlf' ? text.replace(/\n/g, '\r\n') : text
}

type SaveStatus = 'idle' | 'pending' | 'writing' | 'saved' | 'error'

function ProvenanceFooter({ provenance }: { provenance?: TapestryNodeHistory }): React.ReactElement | null {
  if (!provenance) return null
  const { createdBy, changedBy } = provenance
  const wasChangedByOther = changedBy.kind !== createdBy.kind || changedBy.id !== createdBy.id
  return (
    <div
      className="tapestry-provenance-footer"
      title={
        `Created by ${createdBy.id} in change ${provenance.createdSeq}. ` +
        `Last changed by ${changedBy.id} in change ${provenance.changedSeq}.`
      }
      role="group"
      aria-label={
        wasChangedByOther
          ? `Created by ${actorSpokenText(createdBy)}, changed by ${actorSpokenText(changedBy)}`
          : `Created by ${actorSpokenText(createdBy)}`
      }
    >
      <span aria-hidden="true">Created by</span>
      <ProvenanceBadge actor={createdBy} />
      {wasChangedByOther && (
        <>
          <span aria-hidden="true">· changed by</span>
          <ProvenanceBadge actor={changedBy} />
        </>
      )}
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '4px 10px',
  border: '1px solid #D5D1CA',
  borderRadius: 6,
  background: '#FAF9F7',
  color: '#2C2C2C',
  cursor: 'pointer',
}

export default function WorkspaceFileCard({
  treeId,
  node,
  isSelected,
  zoom,
  provenance,
  onBorderSelect,
  onHover,
  onPositionChange,
  onRegisterDims,
  onDragMove,
  onDragEnd,
  openNonce,
}: WorkspaceFileCardProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 })

  const x = Number(node.props['position.x']?.value ?? 0)
  const y = Number(node.props['position.y']?.value ?? 0)
  const storedWidth = node.props['width'] ? Number(node.props['width'].value) : 0

  const isText = node.type === TEXT_TYPE
  const path = propString(node, 'file.path')
  const fileText = propString(node, 'file.text')
  const fileSha = propString(node, 'file.sha256') || null
  const endings = lineEndingsOf(fileText)
  const readOnly = endings === 'mixed'

  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null)
  const effectiveX = localPos ? localPos.x : x
  const effectiveY = localPos ? localPos.y : y

  const [isOpen, setIsOpen] = useState(false)
  const [text, setText] = useState(() => forEditing(fileText, endings))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [fileWinsNotice, setFileWinsNotice] = useState(false)

  // Refs the save chain reads, so a save never uses a stale closure.
  const textRef = useRef(text)
  const baseRef = useRef<string | null>(fileSha)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const endingsRef = useRef(endings)
  endingsRef.current = endings
  const fileTextRef = useRef(fileText)
  fileTextRef.current = fileText

  // While nothing is waiting to be written, the tree's text is the window's.
  useEffect(() => {
    if (dirtyRef.current) return
    const next = forEditing(fileText, endings)
    textRef.current = next
    setText(next)
    baseRef.current = fileSha
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileText, fileSha])

  useEffect(() => {
    if (!isDraggingRef.current && localPos) setLocalPos(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y])

  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      onRegisterDims(node.id, rect.width / zoom, rect.height / zoom)
    }
  })

  // The textarea fits its text, up to a limit, then scrolls.
  useEffect(() => {
    const area = textareaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(MAX_TEXTAREA_HEIGHT, area.scrollHeight + 2)}px`
  }, [text, isOpen])

  // Scrolling inside the window scrolls the text, not the canvas. The
  // viewport's own wheel listener is non-passive and calls preventDefault, so
  // the event must not reach it; pinch-zoom (ctrlKey) still does.
  useEffect(() => {
    const area = textareaRef.current
    if (!area) return undefined
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    area.addEventListener('wheel', onWheel, { passive: true })
    return () => area.removeEventListener('wheel', onWheel)
  }, [isOpen])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const flush = useCallback((): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    chainRef.current = chainRef.current.then(async () => {
      if (!dirtyRef.current) return
      const pending = textRef.current
      dirtyRef.current = false
      setStatus('writing')
      let result: Awaited<ReturnType<typeof window.tapestry.workspace.saveFile>>
      try {
        result = await window.tapestry.workspace.saveFile(
          treeId,
          node.id,
          forDisk(pending, endingsRef.current),
          baseRef.current,
        )
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      if (!result.ok) {
        // The text stays, so the next keystroke (or closing) tries again.
        dirtyRef.current = true
        setError(result.error)
        setStatus('error')
        return
      }
      setError(null)
      baseRef.current = result.value.sha256
      if (result.value.fileWins) {
        // Drop what was typed: the file's version is the one shown. The tree
        // refresh brings its text; until then, show what the tree last said.
        dirtyRef.current = false
        const shown = forEditing(fileTextRef.current, endingsRef.current)
        textRef.current = shown
        setText(shown)
        setFileWinsNotice(true)
        setStatus('saved')
        return
      }
      setStatus(dirtyRef.current ? 'pending' : 'saved')
    })
    return chainRef.current
  }, [treeId, node.id])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value
      textRef.current = next
      dirtyRef.current = true
      setText(next)
      setStatus('pending')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void flush()
      }, WORKSPACE_SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  const openWindow = useCallback(() => {
    if (!isText) return
    if (!dirtyRef.current) {
      const current = forEditing(fileText, endings)
      textRef.current = current
      setText(current)
      baseRef.current = fileSha
    }
    setStatus('idle')
    setIsOpen(true)
  }, [isText, fileText, fileSha, endings])

  useEffect(() => {
    if (openNonce === undefined || consumedOpenNonces.has(openNonce)) return
    consumedOpenNonces.add(openNonce)
    openWindow()
  }, [openNonce, openWindow])

  const closeWindow = useCallback(async () => {
    await flush()
    setIsOpen(false)
  }, [flush])

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()

      isDraggingRef.current = true
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        startX: effectiveX,
        startY: effectiveY,
      }

      const onMove = (me: PointerEvent): void => {
        if (!isDraggingRef.current) return
        const nextX = dragStartRef.current.startX + (me.clientX - dragStartRef.current.mouseX) / zoom
        const nextY = dragStartRef.current.startY + (me.clientY - dragStartRef.current.mouseY) / zoom
        setLocalPos({ x: nextX, y: nextY })
        onDragMove?.(node.id, nextX, nextY)
      }

      const onUp = (): void => {
        isDraggingRef.current = false
        document.removeEventListener('pointermove', onMove, true)
        document.removeEventListener('pointerup', onUp, true)
        onDragEnd?.(node.id)
        setLocalPos((pos) => {
          if (pos) onPositionChange(node.id, pos.x, pos.y)
          return pos
        })
      }

      document.addEventListener('pointermove', onMove, true)
      document.addEventListener('pointerup', onUp, true)
    },
    [effectiveX, effectiveY, zoom, node.id, onPositionChange, onDragMove, onDragEnd],
  )

  // Keys typed in the window belong to the window.
  const isolateKeys = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        void closeWindow()
      }
    },
    [closeWindow],
  )
  const isolatePointer = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
  }, [])

  const defaultWidth = isText ? 280 : 240
  const width = isOpen ? OPEN_WIDTH : storedWidth > 0 ? storedWidth : defaultWidth

  // Ask Claude… about this file (D-19): the chat for its workspace, with the
  // file's path attached to the first message.
  const { openChat, treeName } = useContext(ChatContext)
  const openContextMenu = useContextMenu()
  const askClaude = useCallback(() => {
    openChat({
      treeId,
      attachment: { kind: 'file', workspaceTreeId: treeId, workspaceName: treeName(treeId), path },
    })
  }, [openChat, treeName, treeId, path])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Inside the open file's text, the native menu stays for copy and paste.
      if ((e.target as HTMLElement).closest('textarea')) return
      openContextMenu(e, [{ label: 'Ask Claude…', run: askClaude }])
    },
    [openContextMenu, askClaude],
  )

  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
      <div
        title={path}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.3,
          color: '#2C2C2C',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {baseName(path)}
      </div>
      <AskClaudeButton label={`Ask Claude about ${baseName(path)}`} onAsk={askClaude} />
    </div>
  )

  let body: React.ReactElement
  if (!isText) {
    const ext = propString(node, 'file.ext')
    const bytes = Number(node.props['file.bytes']?.value ?? 0)
    const unreadable = propString(node, 'file.unreadable')
    body = (
      <div style={{ fontSize: 13, lineHeight: 1.4, color: MUTED }}>
        <div>
          {ext || 'no extension'} file · {bytes} bytes
        </div>
        {unreadable && <div style={{ marginTop: 4 }}>Not shown: {unreadable}</div>}
      </div>
    )
  } else if (!isOpen) {
    const preview = fileText.split('\n').slice(0, PREVIEW_LINES).join('\n')
    body = (
      <>
        <div
          onDoubleClick={(e) => {
            e.stopPropagation()
            openWindow()
          }}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.4,
            maxHeight: 128,
            overflow: 'hidden',
            whiteSpace: 'pre',
            color: '#2C2C2C',
          }}
        >
          {preview}
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            style={buttonStyle}
            onPointerDown={isolatePointer}
            onClick={(e) => {
              e.stopPropagation()
              openWindow()
            }}
          >
            Open file
          </button>
        </div>
      </>
    )
  } else {
    const statusText =
      status === 'pending'
        ? 'Writing soon...'
        : status === 'writing'
          ? 'Writing...'
          : status === 'error'
            ? ''
            : 'Up to date'
    body = (
      <>
        {readOnly && (
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>
            This file mixes line endings; edit it outside Tapestry so its bytes are not changed.
          </div>
        )}
        {fileWinsNotice && (
          <div
            role="status"
            style={{
              fontSize: 13,
              lineHeight: 1.4,
              color: '#2C2C2C',
              background: '#FFF4E0',
              border: '1px solid #E8C98A',
              borderRadius: 6,
              padding: '6px 8px',
              marginBottom: 6,
            }}
          >
            This file changed outside Tapestry before your edit was written. The file&apos;s
            version is shown. Your edit is kept in history.{' '}
            <button
              type="button"
              style={{ ...buttonStyle, marginLeft: 6 }}
              onPointerDown={isolatePointer}
              onKeyDown={isolateKeys}
              onClick={(e) => {
                e.stopPropagation()
                setFileWinsNotice(false)
              }}
            >
              Hide notice
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          wrap="off"
          onChange={handleChange}
          onKeyDown={isolateKeys}
          onPointerDown={isolatePointer}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label={`Contents of ${path}`}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            border: '1px solid #E0DDD7',
            borderRadius: 6,
            padding: 8,
            resize: 'none',
            overflowY: 'auto',
            whiteSpace: 'pre',
            color: '#2C2C2C',
            background: readOnly ? '#F5F4F1' : '#FFFFFF',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 6,
            gap: 8,
          }}
        >
          <div aria-live="polite" style={{ fontSize: 12, color: error ? DESTRUCTIVE : MUTED }}>
            {error ?? statusText}
          </div>
          <button
            type="button"
            style={buttonStyle}
            onPointerDown={isolatePointer}
            onKeyDown={isolateKeys}
            onClick={(e) => {
              e.stopPropagation()
              void closeWindow()
            }}
          >
            Close file
          </button>
        </div>
      </>
    )
  }

  return (
    <div
      ref={cardRef}
      className={`tapestry-note-card${isSelected ? ' tapestry-note-card--selected' : ''}`}
      style={{
        left: `${effectiveX}px`,
        top: `${effectiveY}px`,
        width: `${width}px`,
        maxWidth: 'none',
        zIndex: isOpen ? 20 : undefined,
        boxShadow: isOpen ? '0 6px 24px rgba(0, 0, 0, 0.18)' : undefined,
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onContextMenu={handleContextMenu}
    >
      <div
        className="tapestry-note-drag-handle"
        onPointerDown={handleDragStart}
        onClick={(e) => {
          e.stopPropagation()
          onBorderSelect()
        }}
      />
      {title}
      {body}
      <ProvenanceFooter provenance={provenance} />
    </div>
  )
}
