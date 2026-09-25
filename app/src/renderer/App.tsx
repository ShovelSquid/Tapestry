/**
 * Main Tapestry application -- the space, holding one frame per open tree
 * (D-15) on a full-window 2D canvas.
 *
 * App owns the data layer through useForest: which trees are open, each one's
 * nodes, edges, provenance and save state. Canvas owns the view. Every handler
 * here names a note by NodeRef (tree + node), because a node id alone is only
 * unique inside one tree.
 *
 * Double-clicking empty space inside a frame creates a note in that tree
 * (D-04). Double-clicking outside every frame creates nothing (UA-06): a note
 * has to belong to a tree.
 *
 * Save state tracking (D-02) is per tree, in useForest:
 * - "Saving..." while any of that tree's notes has a debounce timer active OR
 *   an IPC call in flight
 * - "Saved" only when both are empty
 * - "Not saved" after a failed call
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Canvas, { type CanvasHandle, type DoubleClickTarget } from './components/Canvas'
import ForestBar from './components/ForestBar'
import { LiveAnnouncer } from './components/LiveAnnouncer'
import TransientNotice from './components/TransientNotice'
import PluginErrorNotification from './components/PluginErrorNotification'
import PluginSurfaceLayer, { SurfaceLauncher, type SurfaceInfo } from './components/PluginSurfaceLayer'
import NamePromptDialog from './components/NamePromptDialog'
import ChatPanel, { type ChatPanelState } from './components/ChatPanel'
import { ContextMenuProvider } from './components/ContextMenu'
import {
  EMPTY_FRAME_RUN,
  chooseUndoTarget,
  frameRunEventForDrop,
  nextFrameRun,
  type FrameRun,
  type FrameRunEvent,
} from './state/undo-target'
import { ChatContext, chatWorkspaceFor, type ChatContextValue, type ChatTarget } from './state/chat'
import { COLLAPSED_KEY, revealExpanded, settleSubspace, type DimsOf, type Point } from './layout/subspaces'
import ThreadOverlay from './threads/ThreadOverlay'
import { THREAD_TYPE } from './threads/ThreadCard'
import { threadInitialProperties } from '../shared/threads/settings'
import type { NodeInfo } from './components/Canvas'
import { useForest, type ForestTree, type NodeRef } from './state/use-forest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Looks up a NodeRef's live node data, across whichever tree holds it. */
function findNode(trees: ForestTree[], ref: NodeRef | null): NodeInfo | null {
  if (!ref) return null
  const tree = trees.find((t) => t.id === ref.treeId)
  return tree?.nodes.find((n) => n.id === ref.nodeId) ?? null
}

function stringProp(node: NodeInfo | null, key: string): string {
  const prop = node?.props[key]
  return typeof prop?.value === 'string' ? prop.value : ''
}

/** A note's title, derived from its file name, for a newly created world. */
function worldNameFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop()?.replace(/\.tree$/, '') ?? 'untitled'
  return fileName.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** The file's own name, for copy that names the file rather than its path. */
function fileNameOf(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/** Main's WORKSPACE_REPLAY_REFUSAL, shown before asking (02.7 D-03). */
const WORKSPACE_UNDO_NOTICE =
  "Undo isn't available in a workspace window; the files are the record. Use git to undo a file change."

export default function App(): React.ReactElement {
  const {
    trees,
    lastChangedTreeId,
    selectedTreeId,
    setSelectedTreeId,
    patchNodeProps,
    refreshTree,
    refreshAll,
    refreshTreeList,
    submitChange: submitToTree,
    markDirty,
    markClean,
    setFrameLocal,
  } = useForest()

  const [editingRef, setEditingRef] = useState<NodeRef | null>(null)
  const [selectedRef, setSelectedRef] = useState<NodeRef | null>(null)

  // The space, for the one thing App asks of it: pan to a frame it just added.
  const canvasRef = useRef<CanvasHandle>(null)

  /** A tree that has just been added and is waiting to be panned to. */
  const [pendingPanTreeId, setPendingPanTreeId] = useState<string | null>(null)

  // open_file (02.7 SC2): the note an agent asked to show, its ancestor
  // folders drawn open for this view only (never committed), and the one
  // file window to open.
  const [pendingReveal, setPendingReveal] = useState<{ treeId: string; noteId: string } | null>(null)
  const [revealedFolders, setRevealedFolders] = useState<ReadonlyMap<string, ReadonlySet<string>>>(
    () => new Map(),
  )
  const [openRequest, setOpenRequest] = useState<{ key: string; nonce: number } | null>(null)
  const revealNonceRef = useRef(0)

  // The name every change is signed with (D-07). Null means "not chosen yet",
  // which is what makes the first-run prompt appear; nameLoaded keeps the
  // prompt from flashing before settings have been read.
  const [userName, setUserName] = useState<string | null>(null)
  const [suggestedName, setSuggestedName] = useState('')
  const [nameLoaded, setNameLoaded] = useState(false)

  // Agents (D-03/D-06). One copy of the list and the switch lives here, so
  // the forest bar's label and the panel's rows can never disagree.
  const [agents, setAgents] = useState<TapestryAgentSummary[]>([])
  const [agentsEnabled, setAgentsEnabled] = useState(true)

  // The chat panel (02.7 D-12, D-19): a workspace's chat, a chooser when
  // several workspaces could be meant, or a note that none is open.
  const [chatPanel, setChatPanel] = useState<ChatPanelState | null>(null)
  // The last workspace chatted in, so a click that names none goes back there.
  const [lastChatTreeId, setLastChatTreeId] = useState<string | null>(null)
  const chatTreeId = chatPanel?.kind === 'chat' ? chatPanel.treeId : null

  const openChat = useCallback(
    (target: ChatTarget = {}) => {
      const openTrees = trees
        .filter((tree) => tree.status === 'ok')
        .map((tree) => ({ id: tree.id, name: tree.name, kind: tree.kind }))
      const choice = chatWorkspaceFor(target, openTrees, lastChatTreeId)
      const attachment = target.attachment ?? null
      if ('treeId' in choice) {
        setLastChatTreeId(choice.treeId)
        setChatPanel((previous) => ({
          kind: 'chat',
          treeId: choice.treeId,
          attachment,
          // A new attachment replaces the chip even when this chat is open.
          seq: (previous?.kind === 'chat' ? previous.seq : 0) + 1,
        }))
      } else if ('choose' in choice) {
        setChatPanel({ kind: 'choose', options: choice.choose, attachment })
      } else {
        setChatPanel({ kind: 'none' })
      }
    },
    [trees, lastChatTreeId],
  )

  const chatContext = React.useMemo<ChatContextValue>(
    () => ({
      openTreeId: chatTreeId,
      openChat,
      // Closing the panel stops the chat's process; its session is kept, so
      // the next message continues the conversation.
      closeChat: () => {
        if (chatTreeId !== null) void window.tapestry.chat.stop(chatTreeId)
        setChatPanel(null)
      },
      treeName: (treeId: string) => trees.find((tree) => tree.id === treeId)?.name ?? '',
    }),
    [chatTreeId, openChat, trees],
  )

  // A passing message about something that already happened (UA-14).
  const [notice, setNotice] = useState<string | null>(null)

  // Plugin contributions: maps node types to component names from plugins
  const [pluginNodeViews, setPluginNodeViews] = useState<Record<string, string>>({})

  // Plugin surfaces (CANV-04): what the registry lists, and which one is open.
  const [pluginSurfaces, setPluginSurfaces] = useState<SurfaceInfo[]>([])
  const [openSurface, setOpenSurface] = useState<SurfaceInfo | null>(null)

  // Plugin error notification state (D-34)
  const [pluginError, setPluginError] = useState<{
    /** Plugin id used for reload — never the display name. */
    pluginName: string
    displayName: string
    message: string
    canRestart: boolean
  } | null>(null)

  /**
   * Surface an application-level error through the notification banner
   * (reused from the plugin crash UI). Kernel rejections — a commit refused
   * while history is rewound, a world that will not open — must not disappear
   * into the console.
   */
  const showAppError = useCallback((message: string) => {
    setPluginError({ pluginName: 'tapestry', displayName: 'Tapestry', message, canRestart: false })
  }, [])

  /** Log a failed save and tell the user why. The indicator is already set. */
  const reportSaveError = useCallback(
    (action: string, err: unknown) => {
      console.error(`${action}:`, err)
      showAppError(`${action}: ${errorMessage(err)}`)
    },
    [showAppError],
  )

  // -----------------------------------------------------------------------
  // Frame run (2.6 D-08): how far Ctrl+Z reaches into frame moves
  // -----------------------------------------------------------------------

  /**
   * The consecutive frame moves Ctrl+Z and Ctrl+Shift+Z can reach. A ref, not
   * state: it changes on every drop and nothing renders from it. The rules
   * live in undo-target.ts (nextFrameRun), which is tested on its own.
   */
  const frameRunRef = useRef<FrameRun>(EMPTY_FRAME_RUN)

  const noteFrameEvent = useCallback((event: FrameRunEvent) => {
    frameRunRef.current = nextFrameRun(frameRunRef.current, event)
  }, [])

  /**
   * Every note commit goes through here, so any tree edit ends a frame run:
   * after it, Ctrl+Z means the tree again, not a frame moved earlier.
   */
  const submitChange = useCallback(
    (treeId: string, message: string, ops: any[]) => {
      noteFrameEvent('tree-edited')
      return submitToTree(treeId, message, ops)
    },
    [noteFrameEvent, submitToTree],
  )

  // Starting to edit a note, or selecting a note or a frame, ends the run too.
  useEffect(() => {
    if (editingRef !== null) noteFrameEvent('editing-started')
  }, [editingRef, noteFrameEvent])

  useEffect(() => {
    noteFrameEvent('selection-changed')
  }, [selectedRef, noteFrameEvent])

  useEffect(() => {
    noteFrameEvent('selection-changed')
  }, [selectedTreeId, noteFrameEvent])

  // -----------------------------------------------------------------------
  // Plugins and agents
  // -----------------------------------------------------------------------

  const refreshPluginContributions = useCallback(async () => {
    try {
      const contributions = await window.tapestry.plugins.getContributions()
      const views: Record<string, string> = {}
      for (const [nodeType, contrib] of Object.entries(contributions.nodeViews)) {
        views[nodeType] = (contrib as any).component
      }
      setPluginNodeViews(views)
      setPluginSurfaces(
        Object.values(contributions.surfaces ?? {}).map((s) => ({
          id: s.id,
          displayName: s.displayName,
          entry: s.entry,
          pluginName: s.pluginName,
        })),
      )
    } catch {
      // Plugins not available yet — empty views
    }
  }, [])

  /** Re-read who may connect and who is connected right now. */
  const refreshAgents = useCallback(async () => {
    try {
      const [list, enabled] = await Promise.all([
        window.tapestry.agents.list(),
        window.tapestry.agents.getEnabled(),
      ])
      setAgents(list)
      setAgentsEnabled(enabled)
    } catch {
      // The bridge is unavailable: show no agents rather than stale ones.
      setAgents([])
    }
  }, [])

  useEffect(() => {
    refreshPluginContributions()

    // Listen for plugin error notifications (D-34)
    const removePluginError = window.tapestry.onPluginError(
      (pluginName, displayName, message, canRestart) => {
        // An empty message means the automatic restart succeeded — the
        // notification shows a brief success state and then auto-dismisses.
        setPluginError({ pluginName, displayName, message, canRestart })
      },
    )

    return () => removePluginError()
  }, [refreshPluginContributions])

  useEffect(() => {
    refreshAgents()

    const removeAgentsChanged = window.tapestry.onAgentsChanged(() => {
      refreshAgents()
    })

    // An agent wrote into a tree Kaelen had rewound. The write has already
    // landed and the redo is already gone, so this is a notice about something
    // that happened, not a question — losing redo silently is the failure this
    // exists to prevent.
    const removeRedoDiscarded = window.tapestry.onRedoDiscarded(({ treeId, treeName, actorId }) => {
      refreshTree(treeId)
      const name = actorId.replace(/^agent\./, '')
      setNotice(`agent.${name} added a change to ${treeName}, so redo is no longer available.`)
    })

    // An agent asked to show a workspace file (open_file). The note may have
    // just been recorded, so the tree is refreshed first; the reveal itself
    // waits for the refreshed tree to reach the canvas.
    const removeRevealNote = window.tapestry.onRevealNote(({ treeId, noteId }) => {
      void refreshTree(treeId).then(() => setPendingReveal({ treeId, noteId }))
    })

    return () => {
      removeAgentsChanged()
      removeRedoDiscarded()
      removeRevealNote()
    }
  }, [refreshAgents, refreshTree])

  useEffect(() => {
    if (!pendingReveal) return undefined
    const tree = trees.find((t) => t.id === pendingReveal.treeId)
    if (!tree || !tree.nodes.some((node) => node.id === pendingReveal.noteId)) return undefined

    const { treeId, noteId } = pendingReveal
    const ancestors = revealExpanded(tree.nodes, noteId)
    if (ancestors.length > 0) {
      setRevealedFolders((prev) => {
        const next = new Map(prev)
        next.set(treeId, new Set([...(prev.get(treeId) ?? []), ...ancestors]))
        return next
      })
    }
    revealNonceRef.current += 1
    setOpenRequest({ key: `${treeId}:${noteId}`, nonce: revealNonceRef.current })
    setPendingReveal(null)
    const handle = requestAnimationFrame(() => {
      canvasRef.current?.panToNote(treeId, noteId)
    })
    return () => cancelAnimationFrame(handle)
  }, [pendingReveal, trees])

  // -----------------------------------------------------------------------
  // Space problem (2.6 D-14, answers 4.1-4.8)
  // -----------------------------------------------------------------------

  /** The last space problem shown, so each distinct message appears once. */
  const shownSpaceProblemRef = useRef<string | null>(null)

  // Main opens the space after the window loads, then says trees-changed, so
  // the question is asked on mount and again on every trees-changed. A space
  // that could not open says why in the app-error banner, which stays until
  // dismissed (4.1); the same message is not shown twice.
  useEffect(() => {
    let cancelled = false
    const check = () => {
      window.tapestry.trees
        .spaceProblem()
        .then(({ message }) => {
          if (cancelled) return
          if (message !== null && message !== shownSpaceProblemRef.current) {
            showAppError(message)
          }
          shownSpaceProblemRef.current = message
        })
        .catch((err) => {
          console.error('Could not ask whether the space opened:', err)
        })
    }
    check()
    const removeTreesChanged = window.tapestry.onTreesChanged(check)
    return () => {
      cancelled = true
      removeTreesChanged()
    }
  }, [showAppError])

  // -----------------------------------------------------------------------
  // User name (D-07)
  // -----------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    window.tapestry.settings
      .getUserName()
      .then(({ userName: stored, suggested }) => {
        if (cancelled) return
        setUserName(stored)
        setSuggestedName(suggested)
      })
      .catch(() => {
        // Settings unreadable: fall through to the prompt rather than letting
        // changes be made under an unknown name.
        if (!cancelled) setSuggestedName('')
      })
      .finally(() => {
        if (!cancelled) setNameLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Save the chosen name; resolves to an error to display, or null. */
  const handleSaveUserName = useCallback(async (name: string): Promise<string | null> => {
    const result = await window.tapestry.settings.setUserName(name)
    if (result.ok) {
      setUserName(name)
      return null
    }
    return result.error ?? 'Could not save your name.'
  }, [])

  // -----------------------------------------------------------------------
  // Add tree (D-18): a world joins the space and the canvas moves to it
  // -----------------------------------------------------------------------

  /**
   * Put a world that main has just opened or created into the space.
   *
   * Every failure reads as the UI-SPEC's file-open error rather than as the
   * raw reason: a damaged header, an unreadable file and a copy of a world
   * that is already open all arrive here as text, and what Kaelen can do next
   * is the same in each case. The exception is a refusal main marks with a
   * `notice` (no space open, 4.9; Tapestry's own file, 4.10), which is shown
   * word for word, because the generic sentence would be wrong about it.
   */
  const addTreeToSpace = useCallback(
    async (
      filePath: string,
      result: { ok: boolean; treeId?: string; error?: string; notice?: string },
    ) => {
      if (!result.ok || !result.treeId) {
        if (result.notice) {
          setNotice(result.notice)
          return
        }
        setNotice(
          `Could not open ${fileNameOf(filePath)} -- The file may be damaged or in an ` +
            'unrecognized format. Create a new world or choose another file.',
        )
        return
      }

      // The tree has to be in local state before its frame can be panned to.
      await refreshAll()
      setPendingPanTreeId(result.treeId)
    },
    [refreshAll],
  )

  const handleOpenWorld = useCallback(async () => {
    const picked = await window.tapestry.dialog.showOpenTree()
    if (picked.canceled || !picked.filePath) return
    const opened = await window.tapestry.trees.open(picked.filePath)
    await addTreeToSpace(picked.filePath, opened)
  }, [addTreeToSpace])

  const handleNewWorld = useCallback(async () => {
    const picked = await window.tapestry.dialog.showSave()
    if (picked.canceled || !picked.filePath) return
    const created = await window.tapestry.trees.create(
      picked.filePath,
      worldNameFromPath(picked.filePath),
    )
    await addTreeToSpace(picked.filePath, created)
  }, [addTreeToSpace])

  /**
   * Mirror an Obsidian vault as its own tree (D-10, D-13).
   *
   * Its failure copy is deliberately not the `.tree` file-open copy: when a
   * vault will not open, the first thing anyone wants to know is whether their
   * notes are still there, so the sentence says so.
   *
   * The confirmation dialog the UI-SPEC describes is Plan 08; this is the
   * tracer path — choose the folder, and the vault becomes a frame.
   */
  const handleAddVault = useCallback(async () => {
    const picked = await window.tapestry.dialog.showOpenVaultFolder()
    if (picked.canceled || !picked.folderPath) return

    const added = await window.tapestry.vault.add(picked.folderPath)
    if (!added.ok || !added.treeId) {
      if (added.notice) {
        setNotice(added.notice)
        return
      }
      setNotice(
        `Could not add ${fileNameOf(picked.folderPath)} as a tree -- ` +
          `${added.error ?? 'unknown error'} Nothing in the vault was changed.`,
      )
      return
    }

    // The tree has to be in local state before its frame can be panned to.
    await refreshAll()
    setPendingPanTreeId(added.treeId)
  }, [refreshAll])

  /** Add a workspace folder as a tree (02.7 D-01); mirrors handleAddVault. */
  const handleAddWorkspace = useCallback(async () => {
    const picked = await window.tapestry.dialog.showOpenWorkspaceFolder()
    if (picked.canceled || !picked.folderPath) return

    const added = await window.tapestry.workspace.add(picked.folderPath)
    if (!added.ok || !added.treeId) {
      setNotice(
        `Could not add ${fileNameOf(picked.folderPath)} as a workspace -- ` +
          `${added.error ?? 'unknown error'} Nothing in the folder was changed.`,
      )
      return
    }

    await refreshAll()
    setPendingPanTreeId(added.treeId)
  }, [refreshAll])

  /**
   * Pan to a newly added frame once the space knows about it.
   *
   * Deferred by one animation frame on purpose: main places a new frame from
   * stored positions alone, and the canvas corrects that placement after it
   * has measured the existing frames. Centering before the correction would
   * center where the frame briefly was.
   */
  useEffect(() => {
    if (!pendingPanTreeId) return undefined
    if (!trees.some((tree) => tree.id === pendingPanTreeId)) return undefined

    const treeId = pendingPanTreeId
    const handle = requestAnimationFrame(() => {
      canvasRef.current?.panToFrame(treeId)
      setPendingPanTreeId(null)
    })
    return () => cancelAnimationFrame(handle)
  }, [pendingPanTreeId, trees])

  // -----------------------------------------------------------------------
  // Create note on double-click (D-04)
  // -----------------------------------------------------------------------

  const createNote = useCallback(
    async (treeId: string, x: number, y: number) => {
      // A workspace tree's notes are its files (02.7 D-03); main refuses the
      // commit too, this only says why.
      if (trees.find((tree) => tree.id === treeId)?.kind === 'workspace') {
        setNotice(
          "Workspace windows hold files. Create a file with an agent's write_file or in your editor.",
        )
        return
      }
      try {
        const commitResult = await submitChange(treeId, 'Create note', [
          {
            op: 'createNode',
            type: 'tapestry.notes/note@1',
            props: {
              'position.x': { type: 'real', value: x },
              'position.y': { type: 'real', value: y },
              body: { type: 'text', value: '' },
              title: { type: 'text', value: '' },
            },
          },
        ])

        await refreshTree(treeId)

        if (commitResult.nodeIds && commitResult.nodeIds.length > 0) {
          setEditingRef({ treeId, nodeId: commitResult.nodeIds[0] })
        }
      } catch (err) {
        reportSaveError('Failed to create note', err)
      }
    },
    [trees, submitChange, refreshTree, reportSaveError],
  )

  const handleCanvasDoubleClick = useCallback(
    async (target: DoubleClickTarget) => {
      // Inside a frame: the note belongs to that tree, at frame-local coords.
      if (target.treeId) {
        await createNote(target.treeId, target.x, target.y)
        return
      }

      // No tree open at all: ask where to save, create the world, then put the
      // first note at its origin.
      const result = await window.tapestry.dialog.showSave()
      if (result.canceled || !result.filePath) return

      const created = await window.tapestry.trees.create(
        result.filePath,
        worldNameFromPath(result.filePath),
      )
      if (!created.ok || !created.treeId) {
        // Show the reason (invalid location, file already exists, ...) instead
        // of silently doing nothing on double-click.
        showAppError(`Could not create world: ${created.error ?? 'unknown error'}`)
        return
      }

      // The new tree has to be in local state before a note can go into it.
      await refreshAll()
      await createNote(created.treeId, 0, 0)
    },
    [createNote, refreshAll, showAppError],
  )

  // -----------------------------------------------------------------------
  // Create a thread (D-01, D-27) and open its overlay to start typing.
  // -----------------------------------------------------------------------

  const createThread = useCallback(
    async (treeId: string, x: number, y: number) => {
      try {
        const commitResult = await submitChange(treeId, 'Create thread', [
          { op: 'createNode', type: THREAD_TYPE, props: threadInitialProperties(x, y) },
        ])
        await refreshTree(treeId)
        if (commitResult.nodeIds && commitResult.nodeIds.length > 0) {
          setEditingRef({ treeId, nodeId: commitResult.nodeIds[0] })
        }
      } catch (err) {
        reportSaveError('Failed to create thread', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  /**
   * "Start a thread" (UI-SPEC's canvas-menu copy). A thread must belong to a
   * tree (D-24), same as a note: with one already open, place it a fixed
   * offset from the origin; with none open, ask where to save first, exactly
   * like the canvas double-click flow above.
   */
  const handleNewThread = useCallback(async () => {
    if (trees.length > 0) {
      await createThread(trees[0].id, 40, 40)
      return
    }
    const result = await window.tapestry.dialog.showSave()
    if (result.canceled || !result.filePath) return

    const created = await window.tapestry.trees.create(result.filePath, worldNameFromPath(result.filePath))
    if (!created.ok || !created.treeId) {
      showAppError(`Could not create world: ${created.error ?? 'unknown error'}`)
      return
    }
    await refreshAll()
    await createThread(created.treeId, 0, 0)
  }, [trees, createThread, refreshAll, showAppError])

  /**
   * "Start a thread" from the canvas menu: in the frame under the pointer, at
   * that spot; outside every frame, the same fallback as the button had.
   */
  const handleStartThread = useCallback(
    async (target: DoubleClickTarget) => {
      if (target.treeId !== null) {
        await createThread(target.treeId, target.x, target.y)
        return
      }
      await handleNewThread()
    },
    [createThread, handleNewThread],
  )

  // -----------------------------------------------------------------------
  // Note edits. Each names its tree, so a commit lands in one journal.
  // -----------------------------------------------------------------------

  const handlePositionChange = useCallback(
    async (ref: NodeRef, newX: number, newY: number) => {
      try {
        await submitChange(ref.treeId, 'Move note', [
          { op: 'setProperty', target: ref.nodeId, key: 'position.x', type: 'real', value: newX },
          { op: 'setProperty', target: ref.nodeId, key: 'position.y', type: 'real', value: newY },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to update position', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  /**
   * A person moved a note that was following its parent (D-03, D-16). The
   * file records the takeover readably: position and pinned=true in one
   * 'Move note' commit, after which the note stops following.
   */
  const handleTakeOverPosition = useCallback(
    async (ref: NodeRef, newX: number, newY: number) => {
      try {
        await submitChange(ref.treeId, 'Move note', [
          { op: 'setProperty', target: ref.nodeId, key: 'position.x', type: 'real', value: newX },
          { op: 'setProperty', target: ref.nodeId, key: 'position.y', type: 'real', value: newY },
          { op: 'setProperty', target: ref.nodeId, key: 'pinned', type: 'bool', value: true },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to update position', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  /** Thread center pin (D-17): position + pinned=true in one commit. */
  const handlePinnedPositionChange = useCallback(
    async (ref: NodeRef, newX: number, newY: number) => {
      try {
        await submitChange(ref.treeId, 'Pin thread center', [
          { op: 'setProperty', target: ref.nodeId, key: 'position.x', type: 'real', value: newX },
          { op: 'setProperty', target: ref.nodeId, key: 'position.y', type: 'real', value: newY },
          { op: 'setProperty', target: ref.nodeId, key: 'pinned', type: 'bool', value: true },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to pin thread center', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleWidthChange = useCallback(
    async (ref: NodeRef, newWidth: number) => {
      try {
        await submitChange(ref.treeId, 'Resize note', [
          { op: 'setProperty', target: ref.nodeId, key: 'width', type: 'real', value: newWidth },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to update width', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleHeightChange = useCallback(
    async (ref: NodeRef, newHeight: number) => {
      try {
        await submitChange(ref.treeId, 'Resize note height', [
          { op: 'setProperty', target: ref.nodeId, key: 'height', type: 'real', value: newHeight },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to update height', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleEdgeCreate = useCallback(
    async (from: NodeRef, to: NodeRef) => {
      // Canvas only offers same-tree connections; this is the second guard.
      if (from.treeId !== to.treeId) return
      try {
        await submitChange(from.treeId, 'Connect notes', [
          { op: 'createEdge', from: from.nodeId, to: to.nodeId, label: 'link' },
        ])
        await refreshTree(from.treeId)
      } catch (err) {
        reportSaveError('Failed to create edge', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleNoteSave = useCallback(
    async (ref: NodeRef, body: string, title: string): Promise<void> => {
      try {
        await submitChange(ref.treeId, 'Update note text', [
          { op: 'setProperty', target: ref.nodeId, key: 'body', type: 'text', value: body },
          { op: 'setProperty', target: ref.nodeId, key: 'title', type: 'text', value: title },
        ])

        // Mirror the saved values locally so the NoteCard `body` prop does not
        // lag the kernel. A stale prop would later look like an external
        // change and reset the editor mid-typing.
        patchNodeProps(ref, {
          body: { type: 'text', value: body },
          title: { type: 'text', value: title },
        })
      } catch (err) {
        reportSaveError('Failed to save note', err)
      }
    },
    [submitChange, patchNodeProps, reportSaveError],
  )

  /** Fallback property edit (D-35: disabled plugin content stays editable). */
  const handlePropertyEdit = useCallback(
    async (
      ref: NodeRef,
      key: string,
      type: string,
      value: string | number | boolean,
    ): Promise<void> => {
      try {
        await submitChange(ref.treeId, `Edit property ${key}`, [
          { op: 'setProperty', target: ref.nodeId, key, type, value },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to edit property', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleDeleteNote = useCallback(
    async (ref: NodeRef) => {
      // A workspace note is what a file says (02.7 D-03): removing it from the
      // canvas would record a file as gone while it is still on disk.
      const target = trees
        .find((tree) => tree.id === ref.treeId)
        ?.nodes.find((node) => node.id === ref.nodeId)
      if (target?.type.startsWith('tapestry.workspace/')) {
        setNotice('Workspace files are deleted in their folder, not on the canvas. Nothing was changed.')
        return
      }
      try {
        await submitChange(ref.treeId, 'Delete note', [{ op: 'deleteNode', id: ref.nodeId }])

        setEditingRef((prev) =>
          prev && prev.treeId === ref.treeId && prev.nodeId === ref.nodeId ? null : prev,
        )

        // Edges touching the deleted node are cascaded, so the whole tree is
        // re-read rather than just its nodes.
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to delete note', err)
      }
    },
    [trees, submitChange, refreshTree, reportSaveError],
  )

  // -----------------------------------------------------------------------
  // Workspace folder frames (02.7 D-21). Layout only: `collapsed` and
  // positions are Tapestry's keys, so nothing here reaches a file.
  // -----------------------------------------------------------------------

  /** The folder's path, for the commit message a person reads in history. */
  const folderPathOf = useCallback(
    (treeId: string, folderId: string): string => {
      const node = trees.find((tree) => tree.id === treeId)?.nodes.find((n) => n.id === folderId)
      const path = node?.props['file.path']?.value
      return typeof path === 'string' ? path : folderId
    },
    [trees],
  )

  /**
   * Collapse or expand a folder frame, as one commit by the person. Expanding
   * also moves whatever the grown frame now covers (settleSubspace), up to the
   * workspace frame; collapsing moves nothing.
   */
  const handleToggleFolder = useCallback(
    async (treeId: string, folderId: string, collapsed: boolean, dimsOf: DimsOf) => {
      const tree = trees.find((t) => t.id === treeId)
      if (!tree) return
      const path = folderPathOf(treeId, folderId)
      // Collapsing a folder open_file drew open ends that view-only reveal.
      if (collapsed && revealedFolders.get(treeId)?.has(folderId)) {
        setRevealedFolders((prev) => {
          const next = new Map(prev)
          next.delete(treeId)
          return next
        })
      }
      const toggle = { op: 'setProperty', target: folderId, key: COLLAPSED_KEY, type: 'bool', value: collapsed }
      const ops = collapsed
        ? [toggle]
        : [toggle, ...settleSubspace(tree.nodes, dimsOf, folderId, { expanded: new Set([folderId]) })]
      try {
        await submitChange(treeId, `${collapsed ? 'Collapse' : 'Expand'} folder ${path}`, ops)
        await refreshTree(treeId)
      } catch (err) {
        reportSaveError(`Failed to ${collapsed ? 'collapse' : 'expand'} folder`, err)
      }
    },
    [trees, folderPathOf, revealedFolders, submitChange, refreshTree, reportSaveError],
  )

  /**
   * A folder frame dropped at `local` (its parent's space): one commit by the
   * person writing the folder's position and the positions of whatever yields
   * (settleSubspace, up to the workspace frame). The folder's files keep their
   * local positions, so none of them is named.
   */
  const handleFolderDrop = useCallback(
    async (treeId: string, folderId: string, local: Point, dimsOf: DimsOf) => {
      const tree = trees.find((t) => t.id === treeId)
      if (!tree) return
      const path = folderPathOf(treeId, folderId)
      const displaced = settleSubspace(tree.nodes, dimsOf, folderId, {
        positions: new Map([[folderId, local]]),
      }).filter((op) => op.target !== folderId)
      const ops = [
        { op: 'setProperty', target: folderId, key: 'position.x', type: 'real', value: local.x },
        { op: 'setProperty', target: folderId, key: 'position.y', type: 'real', value: local.y },
        ...displaced,
      ]
      try {
        await submitChange(treeId, `Move folder ${path}`, ops)
        await refreshTree(treeId)
      } catch (err) {
        reportSaveError('Failed to move folder', err)
      }
    },
    [trees, folderPathOf, submitChange, refreshTree, reportSaveError],
  )

  // -----------------------------------------------------------------------
  // Plugin error handlers (D-34)
  // -----------------------------------------------------------------------

  const handlePluginRestart = useCallback(
    async (pluginName: string) => {
      // reload() resolves with a status rather than throwing on failure; only
      // a 'loaded' result means the restart actually worked.
      try {
        const result = await window.tapestry.plugins.reload(pluginName)
        if (result.status === 'loaded') {
          setPluginError(null)
          await refreshPluginContributions()
        } else {
          setPluginError(
            (prev) =>
              prev && {
                ...prev,
                message: `${prev.displayName} could not restart: ${result.reason ?? result.status}`,
                canRestart: true,
              },
          )
        }
      } catch (err) {
        console.error('Failed to restart plugin:', err)
        setPluginError(
          (prev) =>
            prev && {
              ...prev,
              message: `${prev.displayName} could not restart: ${errorMessage(err)}`,
              canRestart: true,
            },
        )
      }
    },
    [refreshPluginContributions],
  )

  const handlePluginErrorDismiss = useCallback(() => {
    setPluginError(null)
  }, [])

  // -----------------------------------------------------------------------
  // Undo/Redo (D-22): Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z at the window level
  // -----------------------------------------------------------------------

  /**
   * The result of a batch the canvas recorded (2.6 D-11). A committed drag
   * starts or extends the frame run; a neighbour pushed aside by a note
   * landing or resizing does not, because that tree edit already ended the
   * run (D-08, review WR-04; the rule is frameRunEventForDrop's). A batch
   * that could not be recorded is shown with the approved wording (4.12),
   * and every frame goes back to where the forest has it.
   */
  const handleFramesMoved = useCallback(
    (result: { ok: boolean; committed?: boolean; error?: string }, frameMoved: boolean) => {
      if (result.ok) {
        const event = frameRunEventForDrop(result, frameMoved)
        if (event !== null) noteFrameEvent(event)
        return
      }
      showAppError(`Could not move the frame: ${result.error ?? 'unknown error'}`)
      void refreshTreeList()
    },
    [noteFrameEvent, showAppError, refreshTreeList],
  )

  /**
   * Close a tree, from Tree options or an unavailable frame (review WR-03).
   *
   * Closing needs a name and an open space, so main can refuse it. A refusal
   * main marks with a `notice` (4.9, 4.10) is shown word for word, as
   * addTreeToSpace does; any other failure goes to the banner in the same
   * `<action> failed: <error>` form Undo and Redo use. A close that works
   * needs nothing here: main's trees-changed refreshes the list.
   */
  const handleCloseTree = useCallback(
    async (treeId: string) => {
      try {
        const result = await window.tapestry.trees.close(treeId)
        if (result.ok) return
        if (result.notice) {
          setNotice(result.notice)
          return
        }
        showAppError(`Close tree failed: ${result.error ?? 'unknown error'}`)
      } catch (err) {
        console.error('Close tree failed:', err)
        showAppError(`Close tree failed: ${errorMessage(err)}`)
      }
    },
    [showAppError],
  )

  /**
   * Undo or redo a drop (2.6 D-08, D-09). Main writes a new forest commit
   * with origins it read from the forest; nothing here names a position or
   * an actor. The run follows main's stacks, so it never promises a step
   * main no longer holds.
   */
  const handleFrameStep = useCallback(
    async (direction: 'undo' | 'redo') => {
      try {
        const result =
          direction === 'undo'
            ? await window.tapestry.trees.undoFrames()
            : await window.tapestry.trees.redoFrames()
        if (!result.ok) throw new Error(result.error ?? 'unknown error')

        noteFrameEvent(direction === 'undo' ? 'frames-undone' : 'frames-redone')
        const run = frameRunRef.current
        frameRunRef.current = {
          undoable: Math.min(run.undoable, result.undoable ?? 0),
          redoable: Math.min(run.redoable, result.redoable ?? 0),
        }
        if (result.committed) await refreshTreeList()
      } catch (err) {
        frameRunRef.current = EMPTY_FRAME_RUN
        const action = direction === 'undo' ? 'Undo failed' : 'Redo failed'
        console.error(`${action}:`, err)
        showAppError(`${action}: ${errorMessage(err)}`)
      }
    },
    [noteFrameEvent, refreshTreeList, showAppError],
  )

  const handleUndo = useCallback(
    async (treeId: string) => {
      // Main refuses replay on a workspace tree (02.7 D-03); say why up front.
      if (trees.find((tree) => tree.id === treeId)?.kind === 'workspace') {
        setNotice(WORKSPACE_UNDO_NOTICE)
        return
      }
      try {
        const result = await window.tapestry.kernel.undo(treeId)
        if (result.ok) {
          setEditingRef(null)
          await refreshTree(treeId)
        }
      } catch (err) {
        console.error('Undo failed:', err)
        showAppError(`Undo failed: ${errorMessage(err)}`)
      }
      noteFrameEvent('tree-undo')
    },
    [trees, refreshTree, showAppError, noteFrameEvent],
  )

  const handleRedo = useCallback(
    async (treeId: string) => {
      // Main refuses replay on a workspace tree (02.7 D-03); say why up front.
      if (trees.find((tree) => tree.id === treeId)?.kind === 'workspace') {
        setNotice(WORKSPACE_UNDO_NOTICE)
        return
      }
      try {
        const result = await window.tapestry.kernel.redo(treeId)
        if (result.ok) {
          setEditingRef(null)
          await refreshTree(treeId)
        }
      } catch (err) {
        console.error('Redo failed:', err)
        showAppError(`Redo failed: ${errorMessage(err)}`)
      }
      noteFrameEvent('tree-redo')
    },
    [trees, refreshTree, showAppError, noteFrameEvent],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingRef(null)
        return
      }

      // Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo (D-22). When
      // ProseMirror has focus, let it handle undo/redo for uncommitted text.
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z') {
        const active = document.activeElement
        if (active && active.closest('.ProseMirror')) return

        e.preventDefault()
        e.stopPropagation()

        // Which journal this press acts on (undo-target.ts). Right after a
        // frame drag it is the forest's compensating frame undo (2.6 D-08).
        // Otherwise it is a tree, in the order App has always used: the note
        // being edited or selected is the clearest statement of what the
        // person is working on; a selected frame outranks "the tree I last
        // changed" but not the note actually being edited or selected; with
        // nothing selected, the tree they last changed is the next best
        // answer, and the only open tree is the answer when there is just one.
        const direction = e.shiftKey ? 'redo' : 'undo'
        const target = chooseUndoTarget({
          direction,
          frameRun: frameRunRef.current,
          editingTreeId: editingRef?.treeId ?? null,
          selectedNoteTreeId: selectedRef?.treeId ?? null,
          selectedTreeId,
          lastChangedTreeId,
          firstTreeId: trees[0]?.id ?? null,
        })
        if (target === null) return
        if (target.kind === 'frames') {
          void handleFrameStep(direction)
        } else if (direction === 'redo') {
          void handleRedo(target.treeId)
        } else {
          void handleUndo(target.treeId)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    handleUndo,
    handleRedo,
    handleFrameStep,
    editingRef,
    selectedRef,
    selectedTreeId,
    lastChangedTreeId,
    trees,
  ])

  // A chat panel belongs to an open workspace: when that tree leaves the
  // space (Close tree), its panel goes too.
  useEffect(() => {
    if (chatTreeId === null) return
    const tree = trees.find((t) => t.id === chatTreeId)
    if (!tree || tree.kind !== 'workspace' || tree.status !== 'ok') setChatPanel(null)
  }, [trees, chatTreeId])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // The actor id this person's own changes are signed with (D-07). Null until
  // a name exists, which is exactly while the first-run prompt is up.
  const currentUserActorId = userName !== null ? `user.${userName}` : null

  // A thread being edited opens the D-09 overlay instead of inline editing
  // (ThreadCard renders no editor of its own).
  const editingNode = findNode(trees, editingRef)
  const isEditingThread = editingRef !== null && editingNode?.type === THREAD_TYPE

  return (
    // One pair of live regions for the whole space, mounted above everything
    // that announces into them (UI-SPEC screen-reader announcements).
    <LiveAnnouncer>
      <ChatContext.Provider value={chatContext}>
        <ContextMenuProvider>
          <div className="tapestry-app">
            {/* Top-left chrome: add a tree, agents, and the name changes are
                signed with. Save state lives in each frame's header now. */}
            <ForestBar
              agents={agents}
              agentsEnabled={agentsEnabled}
              userName={userName}
              onSaveUserName={handleSaveUserName}
              onAgentsRefresh={refreshAgents}
              onAddVault={handleAddVault}
              onAddWorkspace={handleAddWorkspace}
              onOpenWorld={handleOpenWorld}
              onNewWorld={handleNewWorld}
            />

            {/* Plugin surfaces (CANV-04): one launcher per registered surface */}
            <SurfaceLauncher surfaces={pluginSurfaces} onOpen={setOpenSurface} />

            {/* An agent write ended a rewound state (UA-14) */}
            {notice && <TransientNotice message={notice} onHide={() => setNotice(null)} />}

            {/* Plugin error notification (D-34) */}
            {pluginError && (
              <PluginErrorNotification
                pluginName={pluginError.pluginName}
                displayName={pluginError.displayName}
                message={pluginError.message}
                canRestart={pluginError.canRestart}
                onRestart={handlePluginRestart}
                onDismiss={handlePluginErrorDismiss}
              />
            )}

            {/* First-run name prompt (D-07). Its overlay covers the canvas, so no
                change can be made before a name exists to sign it with. */}
            {nameLoaded && userName === null && (
              <NamePromptDialog
                mode="first-run"
                initialName={suggestedName}
                onSave={handleSaveUserName}
              />
            )}

            {/* An open plugin surface: full-window layer over the canvas (CANV-04) */}
            {openSurface && (
              <PluginSurfaceLayer
                surface={openSurface}
                treeId={selectedTreeId ?? ''}
                onClose={() => setOpenSurface(null)}
              />
            )}

            {/* The space: one frame per open tree, with pan/zoom and connections */}
            <Canvas
              ref={canvasRef}
              trees={trees}
              editingRef={editingRef}
              pluginNodeViews={pluginNodeViews}
              currentUserActorId={currentUserActorId}
              selectedTreeId={selectedTreeId}
              onSelectTree={setSelectedTreeId}
              onStartEditing={(ref) => setEditingRef(ref)}
              onStopEditing={() => setEditingRef(null)}
              onCanvasDoubleClick={handleCanvasDoubleClick}
              onStartThread={handleStartThread}
              onSelectedNoteChange={setSelectedRef}
              onSave={handleNoteSave}
              onMarkDirty={markDirty}
              onMarkClean={markClean}
              onPositionChange={handlePositionChange}
              onTakeOverPosition={handleTakeOverPosition}
              onWidthChange={handleWidthChange}
              onHeightChange={handleHeightChange}
              onPinnedPositionChange={handlePinnedPositionChange}
              onEdgeCreate={handleEdgeCreate}
              onDeleteNote={handleDeleteNote}
              onPropertyEdit={handlePropertyEdit}
              onFrameMove={setFrameLocal}
              onFramesMoved={handleFramesMoved}
              onCloseTree={(treeId) => void handleCloseTree(treeId)}
              onToggleFolder={handleToggleFolder}
              onFolderDrop={handleFolderDrop}
              revealedFolders={revealedFolders}
              openRequest={openRequest}
            />

            {/* D-09 live writing view: the typer on top, the canvas dimmed behind. */}
            {isEditingThread && editingRef && (
              <ThreadOverlay
                treeId={editingRef.treeId}
                nodeId={editingRef.nodeId}
                title={stringProp(editingNode, 'title')}
                checkpointBody={stringProp(editingNode, 'body')}
                onClose={() => setEditingRef(null)}
              />
            )}

            {/* Claude beside the canvas, for one workspace (02.7 D-12) */}
            {chatPanel !== null && <ChatPanel state={chatPanel} />}
          </div>
        </ContextMenuProvider>
      </ChatContext.Provider>
    </LiveAnnouncer>
  )
}
