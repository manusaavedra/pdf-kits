import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Platform, Text, View, useWindowDimensions } from "react-native"
import { router } from "expo-router"
import { Check, X } from "lucide-react-native"
import { DocumentDeleteDialog, type DeleteDialogHandle } from "@/components/document-delete-dialog"
import { ImageCropDialog } from "@/components/image-crop-dialog"
import { OperationDialog } from "@/components/operation-dialog"
import { PdfDialogs } from "@/components/pdf-dialogs"
import { styles as s } from "@/components/pdf-styles"
import { IconButton } from "@/components/pdf-ui"
import { useImageCrop } from "@/hooks/use-image-crop"
import type { ImportProgress } from "@/lib/import-progress"
import { useLibrary } from "@/lib/library"
import { blankDocument, mergeDocuments, pickPdfs, scanPhotos } from "@/lib/pdf"
import { exportDocument, type SavedDocument } from "@/lib/storage"

type DocumentActions = {
    documents: SavedDocument[]
    loaded: boolean
    busy: boolean
    importFiles: (open?: boolean) => Promise<void>
    action: (id: string) => void
    openEditor: (doc: SavedDocument, addBlank?: boolean) => void
    requestDelete: (doc: SavedDocument) => void
    toggleFavorite: (doc: SavedDocument) => void
    share: (doc: SavedDocument) => void
    showHelp: () => void
}
const Context = createContext<DocumentActions | null>(null)

export function useDocumentActions() {
    const actions = useContext(Context)
    if (!actions) throw new Error("Acciones de documentos no disponibles.")
    return actions
}

export function DocumentActionsProvider({ children }: { children: ReactNode }) {
    const { width } = useWindowDimensions()
    const compact = width < 650
    const {
        documents,
        loaded,
        commit,
        removeDocument,
        error: libraryError,
    } = useLibrary()
    const [busy, setBusy] = useState(false)
    const working = useRef(false)
    const [progress, setProgress] = useState<ImportProgress | null>(null)
    const [operationTitle, setOperationTitle] = useState<string | undefined>()
    const { cropRequest, cropPhoto } = useImageCrop()
    const [canCancel, setCanCancel] = useState(false)
    const operation = useRef<AbortController | null>(null)
    const [notice, setNotice] = useState<{
        text: string
        error: boolean
    } | null>(null)
    const [dialog, updateDialog] = useState<
        "scan" | "merge" | "choose" | "help" | null
    >(null)
    const [intent, setIntent] = useState("edit")
    const [selected, setSelected] = useState<string[]>([])
    const [blankBetweenDocuments, setBlankBetweenDocuments] = useState(false)
    const [mergeImports, setMergeImports] = useState<SavedDocument[]>([])
    const mergeCandidates = useMemo(
        () => [...mergeImports, ...documents],
        [mergeImports, documents],
    )
    const setDialog = useCallback((next: typeof dialog) => {
        if (next !== "merge") {
            setMergeImports([])
            setSelected([])
        }
        updateDialog(next)
    }, [])
    const deleteDialog = useRef<DeleteDialogHandle>(null)
    const documentsRef = useRef(documents)
    useEffect(() => {
        documentsRef.current = documents
    }, [documents])
    const requestDelete = useCallback(
        (doc: SavedDocument) => deleteDialog.current?.show(doc),
        [],
    )
    const remove = useCallback(
        (id: string) => {
            void removeDocument(id).catch(() =>
                setNotice({
                    text: "No se pudo guardar el borrado. Inténtalo de nuevo.",
                    error: true,
                }),
            )
        },
        [removeDocument],
    )
    useEffect(() => {
        if (!notice) return
        const timeout = setTimeout(() => setNotice(null), 6000)
        return () => clearTimeout(timeout)
    }, [notice])
    const run = useCallback(
        async (
            work: (signal: AbortSignal) => Promise<void>,
            importing = false,
        ) => {
            if (working.current) return
            working.current = true
            const controller = new AbortController()
            operation.current = controller
            setCanCancel(importing)
            setProgress(null)
            setOperationTitle(undefined)
            setBusy(true)
            try {
                await work(controller.signal)
            } catch (error) {
                if (controller.signal.aborted) return
                const message = error instanceof Error ? error.message : ""
                setNotice({
                    text: /encrypt/i.test(message)
                        ? "Este PDF está protegido. Importa una copia sin contraseña."
                        : /parse|invalid pdf/i.test(message)
                          ? "No se pudo abrir este PDF. Comprueba que el archivo sea válido."
                          : message ||
                            "No se pudo procesar el documento. Inténtalo de nuevo.",
                    error: true,
                })
            } finally {
                working.current = false
                operation.current = null
                setCanCancel(false)
                setProgress(null)
                setBusy(false)
            }
        },
        [],
    )
    const openEditor = useCallback(
        (doc: SavedDocument, addBlank = false) => {
            setDialog(null)
            router.push({
                pathname: "/editor",
                params: { id: doc.id, blank: addBlank ? "1" : "0" },
            })
        },
        [setDialog],
    )
    const toggleFavorite = useCallback(
        (doc: SavedDocument) => {
            void run(() =>
                commit(
                    documentsRef.current.map((d) =>
                        d.id === doc.id ? { ...d, favorite: !d.favorite } : d,
                    ),
                ),
            )
        },
        [run, commit],
    )
    const share = useCallback(
        (doc: SavedDocument) => {
            void run(() => exportDocument(doc))
        },
        [run],
    )
    const importFiles = useCallback(async (open = false) => {
        await run(async (signal) => {
            const docs = await pickPdfs({ signal, onProgress: setProgress })
            if (signal.aborted) return
            if (!docs.length) return
            if (dialog === "merge" && !open) {
                setMergeImports((previous) => [...previous, ...docs])
                setSelected((previous) => [
                    ...previous,
                    ...docs.map((doc) => doc.id),
                ])
                return
            }
            setCanCancel(false)
            setProgress({
                phase: "saving",
                completed: docs.length,
                total: docs.length,
            })
            await commit([...docs, ...documentsRef.current], {
                optimistic: false,
                onProgress: (step) => setProgress({ phase: "saving", ...step }),
            })
            if (open)
                openEditor(docs[0], intent === "blank" && dialog === "choose")
            else
                setNotice({
                    text: `${docs.length} documento${docs.length > 1 ? "s" : ""} importado${docs.length > 1 ? "s" : ""}`,
                    error: false,
                })
        }, true)
    }, [commit, dialog, intent, openEditor, run])
    const takePhotos = useCallback((camera: boolean) => {
        return run(async (signal) => {
            setOperationTitle("Seleccionando imágenes")
            setProgress({
                phase: "selecting",
                completed: 0,
                total: 0,
                detail: "Selecciona las imágenes en la cámara o la galería.",
            })
            const doc = await scanPhotos(camera, {
                signal,
                cropPhoto: (source, index, total) =>
                    cropPhoto(source, index, total, signal),
                onProgress: (completed, total) => {
                    setOperationTitle("Creando PDF")
                    setProgress({
                        phase: "checking",
                        completed,
                        total,
                        detail: `Preparando imagen ${Math.min(completed + 1, total)} de ${total}…`,
                    })
                },
            })
            if (!doc || signal.aborted) return
            setOperationTitle("Guardando PDF")
            setProgress({ phase: "saving", completed: 0, total: 1 })
            await commit([doc, ...documentsRef.current], {
                optimistic: false,
                onProgress: (step) => setProgress({ phase: "saving", ...step }),
            })
            openEditor(doc)
        })
    }, [commit, cropPhoto, openEditor, run])
    const action = useCallback((id: string) => {
        if (id === "merge") {
            setMergeImports([])
            setSelected([])
            setBlankBetweenDocuments(false)
            setDialog("merge")
        } else if (id === "scan") setDialog("scan")
        else if (id === "photos") takePhotos(false)
        else {
            setIntent(id)
            setDialog("choose")
        }
    }, [setDialog, takePhotos])
    const showHelp = useCallback(() => setDialog("help"), [setDialog])
    const value = useMemo(() => ({ documents, loaded, busy, importFiles, action, openEditor, requestDelete, toggleFavorite, share, showHelp }), [documents, loaded, busy, importFiles, action, openEditor, requestDelete, toggleFavorite, share, showHelp])
    return (
        <Context.Provider value={value}>
            <View style={{ flex: 1 }}>
                {children}
                <PdfDialogs
                    error={notice?.error ? notice.text : libraryError}
                    dialog={dialog}
                    setDialog={setDialog}
                    intent={intent}
                    documents={documents}
                    mergeCandidates={mergeCandidates}
                    busy={busy}
                    compact={compact}
                    selected={selected}
                    setSelected={setSelected}
                    blankBetweenDocuments={blankBetweenDocuments}
                    setBlankBetweenDocuments={setBlankBetweenDocuments}
                    importFiles={importFiles}
                    takePhotos={takePhotos}
                    openEditor={openEditor}
                    createBlank={() =>
                        run(async () => {
                            const doc = await blankDocument()
                            await commit([doc, ...documentsRef.current])
                            openEditor(doc)
                        })
                    }
                    merge={() =>
                        run(async () => {
                            const doc = await mergeDocuments(
                                selected.map(
                                    (id) =>
                                        mergeCandidates.find((d) => d.id === id)!,
                                ),
                                { blankBetweenDocuments },
                            )
                            await commit([doc, ...documentsRef.current])
                            openEditor(doc)
                        })
                    }
                />
                <DocumentDeleteDialog ref={deleteDialog} onRemove={remove} />
                {notice && (
                    <View
                        style={[
                            s.toast,
                            notice.error && { backgroundColor: "#8D4343" },
                        ]}
                    >
                        {notice.error ? (
                            <X size={18} color="white" />
                        ) : (
                            <Check size={18} color="white" />
                        )}
                        <Text style={s.toastText}>{notice.text}</Text>
                        <IconButton
                            icon={X}
                            color="white"
                            label="Cerrar aviso"
                            onPress={() => setNotice(null)}
                        />
                    </View>
                )}
                <OperationDialog
                    visible={
                        busy &&
                        !cropRequest &&
                        (Platform.OS === "web" || progress?.phase !== "selecting")
                    }
                    progress={progress}
                    title={operationTitle}
                    onCancel={
                        canCancel ? () => operation.current?.abort() : undefined
                    }
                />
                {cropRequest && (
                    <ImageCropDialog
                        key={cropRequest.index}
                        request={cropRequest}
                    />
                )}
            </View>
        </Context.Provider>
    )
}
