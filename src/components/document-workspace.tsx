import { useMemo, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native"
import { router } from "expo-router"
import { LinearGradient } from "expo-linear-gradient"
import { ArrowRight, ChevronRight, FileText, FolderOpen, ImagePlus, LayoutGrid, List, LockKeyhole, Merge, Plus, ScanLine, Search, Sparkles, type LucideIcon } from "lucide-react-native"
import { DocumentCard } from "@/components/document-card"
import { useDocumentActions } from "@/components/document-actions"
import { Button, HeroIllustration, IconButton } from "@/components/pdf-ui"
import { green, styles as s } from "@/components/pdf-styles"
import type { TabSection } from "@/lib/app-navigation"

const tools: {
    title: string
    description: string
    icon: LucideIcon
    color: string
    bg: string
    action: string
}[] = [
    {
        title: "Editar PDF",
        description: "Dale tu toque a cada página",
        icon: FileText,
        color: "#357761",
        bg: "#EAF3EE",
        action: "edit",
    },
    {
        title: "Unir documentos",
        description: "Varios archivos, un solo PDF",
        icon: Merge,
        color: "#7760AB",
        bg: "#F0ECF8",
        action: "merge",
    },
    {
        title: "Escanear documento",
        description: "Del papel a tu pantalla",
        icon: ScanLine,
        color: "#438C83",
        bg: "#E8F4F1",
        action: "scan",
    },
    {
        title: "Fotos a PDF",
        description: "Tus imágenes, bien reunidas",
        icon: ImagePlus,
        color: "#B4697E",
        bg: "#FAECF0",
        action: "photos",
    },
]
export function DocumentWorkspace({ section: active }: { section: TabSection }) {
    const { width } = useWindowDimensions()
    const desktop = width >= 1000
    const compact = width < 650
    const { documents, loaded, busy, importFiles, action, openEditor, requestDelete, toggleFavorite, share } = useDocumentActions()
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState("all")
    const [showGrid, setDocumentGrid] = useState(false)
    const filtered = useMemo(
        () =>
            documents
                .filter(
                    (doc) =>
                        doc.name.toLowerCase().includes(search.toLowerCase()) &&
                        (active === "favorites"
                            ? !!doc.favorite
                            : (filter !== "scan" || doc.kind === "scan") &&
                              (filter !== "pdf" || doc.kind === "pdf")),
                )
                .sort((a, b) => b.updated - a.updated),
        [documents, search, active, filter],
    )
    return (
        <FlatList
            key={showGrid && !compact ? "grid" : "list"}
            data={
                loaded && active !== "tools"
                    ? active === "home"
                        ? filtered.slice(0, 6)
                        : filtered
                    : []
            }
            keyExtractor={(doc) => doc.id}
            numColumns={showGrid && !compact ? 3 : 1}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            contentContainerStyle={[
                s.content,
                { gap: 14 },
                compact && { padding: 22, paddingBottom: 32 },
            ]}
            columnWrapperStyle={
                showGrid && !compact ? { gap: 14 } : undefined
            }
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
                <View
                    style={{
                        flex: 1,
                        maxWidth: showGrid && !compact ? "32%" : "100%",
                    }}
                >
                    <DocumentCard
                        doc={item}
                        grid={showGrid}
                        busy={busy}
                        onOpen={openEditor}
                        onFavorite={toggleFavorite}
                        onExport={share}
                        onDelete={requestDelete}
                    />
                </View>
            )}
            ListHeaderComponent={
                <View style={{ gap: 28 }}>
                    {active === "files" && (
                        <View
                            style={{
                                alignItems: compact
                                    ? "stretch"
                                    : "flex-end",
                            }}
                        >
                            <Button
                                label="Importar PDF"
                                icon={Plus}
                                onPress={() => importFiles()}
                                disabled={busy || !loaded}
                            />
                        </View>
                    )}
                    {active === "home" && (
                        <View
                            style={[
                                s.heroRow,
                                !desktop && { flexDirection: "column" },
                            ]}
                        >
                            <LinearGradient
                                colors={["#EAF0DF", "#F1F3E8"]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={[
                                    s.hero,
                                    compact && {
                                        padding: 25,
                                        minHeight: 275,
                                    },
                                ]}
                            >
                                <View
                                    style={[
                                        s.heroCopy,
                                        compact && { maxWidth: "85%" },
                                    ]}
                                >
                                    <View style={s.heroTag}>
                                        <Sparkles
                                            size={13}
                                            color={green}
                                        />
                                        <Text style={s.heroTagText}>
                                            HECHO PARA TU DÍA A DÍA
                                        </Text>
                                    </View>
                                    <Text
                                        style={[
                                            s.heroTitle,
                                            compact && { fontSize: 26 },
                                        ]}
                                    >
                                        Grandes ideas.{"\n"}Cero
                                        complicaciones.
                                    </Text>
                                    <Text style={s.heroDescription}>
                                        De la primera hoja al último
                                        detalle,{"\n"}todo lo que
                                        necesitas para tus PDF.
                                    </Text>
                                    <Button
                                        label="Abrir un documento"
                                        icon={ArrowRight}
                                        onPress={() =>
                                            importFiles(true)
                                        }
                                        disabled={busy || !loaded}
                                    />
                                </View>
                                <View
                                    pointerEvents="none"
                                    style={[
                                        s.heroArtWrap,
                                        compact && {
                                            right: -90,
                                            opacity: 0.35,
                                            transform: [{ scale: 0.8 }],
                                        },
                                    ]}
                                >
                                    <HeroIllustration />
                                </View>
                            </LinearGradient>
                            <Pressable
                                onPress={() => action("scan")}
                                disabled={busy || !loaded}
                                style={({ pressed }) => [
                                    s.scanCard,
                                    !desktop && {
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 20,
                                        padding: 22,
                                    },
                                    pressed && { opacity: 0.85 },
                                ]}
                            >
                                <View style={s.scannerArt}>
                                    <View
                                        style={[
                                            s.scanCorner,
                                            {
                                                top: 0,
                                                left: 0,
                                                borderTopWidth: 2,
                                                borderLeftWidth: 2,
                                            },
                                        ]}
                                    />
                                    <View
                                        style={[
                                            s.scanCorner,
                                            {
                                                top: 0,
                                                right: 0,
                                                borderTopWidth: 2,
                                                borderRightWidth: 2,
                                            },
                                        ]}
                                    />
                                    <View
                                        style={[
                                            s.scanCorner,
                                            {
                                                bottom: 0,
                                                left: 0,
                                                borderBottomWidth: 2,
                                                borderLeftWidth: 2,
                                            },
                                        ]}
                                    />
                                    <View
                                        style={[
                                            s.scanCorner,
                                            {
                                                bottom: 0,
                                                right: 0,
                                                borderBottomWidth: 2,
                                                borderRightWidth: 2,
                                            },
                                        ]}
                                    />
                                    <FileText
                                        size={47}
                                        color="#9AB8A2"
                                        strokeWidth={1.15}
                                    />
                                    <View style={s.scanBeam} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.scanTitle}>
                                        Del papel al PDF
                                    </Text>
                                    <Text style={s.scanDescription}>
                                        Tu cámara es tu nuevo escáner.
                                    </Text>
                                    <View
                                        style={[
                                            s.row,
                                            { marginTop: 17, gap: 8 },
                                        ]}
                                    >
                                        <Text style={s.scanLink}>
                                            Digitalizar ahora
                                        </Text>
                                        <ArrowRight
                                            size={15}
                                            color={green}
                                        />
                                    </View>
                                </View>
                            </Pressable>
                        </View>
                    )}
                    {(active === "home" || active === "tools") && (
                        <View style={s.section}>
                            {active === "home" && (
                                <View style={s.sectionHeader}>
                                    <Text style={s.sectionTitle}>
                                        ¿Qué quieres hacer hoy?
                                    </Text>
                                    {!compact && (
                                        <Text style={s.sectionNote}>
                                            Un buen resultado, en pocos
                                            pasos
                                        </Text>
                                    )}
                                </View>
                            )}
                            <View style={s.toolGrid}>
                                {tools.map(
                                    ({
                                        title,
                                        description,
                                        icon: Icon,
                                        color,
                                        bg,
                                        action: id,
                                    }) => (
                                        <Pressable
                                            key={id}
                                            disabled={busy || !loaded}
                                            onPress={() => action(id)}
                                            style={({ pressed }) => [
                                                s.toolCard,
                                                {
                                                    width: compact
                                                        ? "49%"
                                                        : "32%",
                                                },
                                                pressed && {
                                                    backgroundColor:
                                                        "#F9FBF7",
                                                    borderColor:
                                                        "#B4C6B3",
                                                    transform: [
                                                        {
                                                            translateY:
                                                                -2,
                                                        },
                                                    ],
                                                },
                                            ]}
                                        >
                                            <View
                                                style={[
                                                    s.toolIcon,
                                                    {
                                                        backgroundColor:
                                                            bg,
                                                    },
                                                ]}
                                            >
                                                <Icon
                                                    color={color}
                                                    size={23}
                                                    strokeWidth={1.6}
                                                />
                                            </View>
                                            <Text style={s.toolTitle}>
                                                {title}
                                            </Text>
                                            <Text
                                                style={
                                                    s.toolDescription
                                                }
                                            >
                                                {description}
                                            </Text>
                                            <ArrowRight
                                                size={15}
                                                color="#929D92"
                                                style={s.toolArrow}
                                            />
                                        </Pressable>
                                    ),
                                )}
                            </View>
                        </View>
                    )}
                    {active !== "tools" && (
                        <View style={s.section}>
                            {active !== "favorites" && (
                                <View style={s.sectionHeader}>
                                    <View style={[s.row, { gap: 9 }]}>
                                        <Text style={s.sectionTitle}>
                                            {active === "home"
                                                ? "Tu biblioteca"
                                                : "Todos tus documentos"}
                                        </Text>
                                        <View style={s.libraryCount}>
                                            <Text
                                                style={{
                                                    fontSize: 11,
                                                    color: "#7A8476",
                                                }}
                                            >
                                                {filtered.length}
                                            </Text>
                                        </View>
                                    </View>
                                    {active === "home" && (
                                        <Pressable
                                            onPress={() =>
                                                router.navigate("/files")
                                            }
                                            style={s.row}
                                        >
                                            <Text style={s.textLink}>
                                                Ver todos
                                            </Text>
                                            <ChevronRight
                                                size={15}
                                                color={green}
                                            />
                                        </Pressable>
                                    )}
                                </View>
                            )}
                            <View
                                style={[
                                    s.libraryToolbar,
                                    compact && {
                                        flexDirection: "column",
                                        alignItems: "stretch",
                                        gap: 14,
                                    },
                                ]}
                            >
                                {active !== "favorites" && (
                                    <View style={s.filters}>
                                        {[
                                            { id: "all", label: "Todos" },
                                            { id: "pdf", label: "PDF" },
                                            {
                                                id: "scan",
                                                label: "Digitalizados",
                                            },
                                        ].map((f) => (
                                            <Pressable
                                                key={f.id}
                                                onPress={() =>
                                                    setFilter(f.id)
                                                }
                                                style={[
                                                    s.filter,
                                                    filter === f.id &&
                                                        s.filterActive,
                                                ]}
                                            >
                                                <Text
                                                    style={[
                                                        s.filterText,
                                                        filter === f.id && {
                                                            color: green,
                                                            fontWeight:
                                                                "600",
                                                        },
                                                    ]}
                                                >
                                                    {f.label}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                )}
                                <View style={s.row}>
                                    <View style={s.search}>
                                        <Search
                                            size={16}
                                            color="#97A094"
                                        />
                                        <TextInput
                                            accessibilityLabel="Buscar documentos"
                                            placeholder="Buscar documento..."
                                            placeholderTextColor="#9AA096"
                                            value={search}
                                            onChangeText={setSearch}
                                            style={s.searchInput}
                                        />
                                    </View>
                                    <View style={s.viewSwitch}>
                                        <IconButton
                                            icon={LayoutGrid}
                                            label="Vista de cuadrícula"
                                            onPress={() =>
                                                setDocumentGrid(true)
                                            }
                                            color={
                                                showGrid ? green : "#A9AFA6"
                                            }
                                        />
                                        <IconButton
                                            icon={List}
                                            label="Vista de lista"
                                            onPress={() =>
                                                setDocumentGrid(false)
                                            }
                                            color={
                                                !showGrid
                                                    ? green
                                                    : "#A9AFA6"
                                            }
                                        />
                                    </View>
                                </View>
                            </View>
                            {!loaded ? (
                                <ActivityIndicator
                                    color={green}
                                    style={{ margin: 60 }}
                                />
                            ) : filtered.length === 0 ? (
                                <View style={s.empty}>
                                    <View style={s.emptyIcon}>
                                        <FolderOpen
                                            size={31}
                                            color="#7F9A77"
                                            strokeWidth={1.4}
                                        />
                                        <View style={s.emptyPlus}>
                                            <Plus
                                                size={12}
                                                color="white"
                                            />
                                        </View>
                                    </View>
                                    <Text style={s.emptyTitle}>
                                        {search
                                            ? "No encontramos ese documento"
                                            : active === "favorites"
                                              ? "Aún no tienes favoritos"
                                              : "Aquí empieza un espacio más organizado"}
                                    </Text>
                                    <Text style={s.emptyText}>
                                        {search
                                            ? active === "favorites"
                                                ? "Prueba con otro nombre."
                                                : "Prueba con otro nombre o cambia el filtro."
                                            : active === "favorites"
                                              ? "Toca el corazón de un documento para añadirlo a tus favoritos."
                                              : "Importa tu primer PDF o digitaliza un documento. Nosotros ponemos las herramientas."}
                                    </Text>
                                    {!search &&
                                        active !== "favorites" && (
                                            <Pressable
                                                onPress={() =>
                                                    importFiles()
                                                }
                                                disabled={busy}
                                                style={s.emptyAction}
                                            >
                                                <Plus
                                                    size={16}
                                                    color={green}
                                                />
                                                <Text
                                                    style={s.textLink}
                                                >
                                                    Añadir mi primer
                                                    documento
                                                </Text>
                                            </Pressable>
                                        )}
                                </View>
                            ) : null}
                        </View>
                    )}
                </View>
            }
            ListFooterComponent={
                active === "home" || active === "files" ? (
                    <View style={s.footer}>
                        <View style={[s.row, { gap: 6 }]}>
                            <LockKeyhole size={12} color="#98A08F" />
                            <Text style={s.footerText}>
                                Hecho para tus documentos. Pensado para tu
                                tranquilidad.
                            </Text>
                        </View>
                        <Text style={s.footerBrand}>
                            pdfkit.{" "}
                            <Text
                                style={{
                                    color: "#A1A797",
                                    fontWeight: "400",
                                }}
                            >
                                Un poco más simple.
                            </Text>
                        </Text>
                    </View>
                ) : null
            }
        />
    )
}
