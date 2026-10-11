import type { ReactNode } from "react"
import { Pressable, Text, View, useWindowDimensions } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, usePathname } from "expo-router"
import { ChevronRight, Files, LockKeyhole, ShieldCheck } from "lucide-react-native"
import { applicationTabs } from "@/lib/app-navigation"
import { useDocumentActions } from "@/components/document-actions"
import { green, styles as s } from "@/components/pdf-styles"

export function ApplicationShell({ children }: { children: ReactNode }) {
    const { width } = useWindowDimensions()
    const desktop = width >= 1000
    const compact = width < 650
    const pathname = usePathname()
    const { documents, showHelp } = useDocumentActions()
    const selected = applicationTabs.find(tab => tab.href === pathname) ?? applicationTabs[0]
    const active = selected.id
    const navigate = (id: string) => {
        const tab = applicationTabs.find(tab => tab.id === id)
        if (tab) router.navigate(tab.href)
    }
    return (
        <SafeAreaView style={s.root} edges={desktop ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}>
            {desktop && (
                <View style={s.sidebar}>
                    <View style={s.brand}>
                        <View style={s.brandIcon}>
                            <Files size={25} color="white" strokeWidth={1.7} />
                        </View>
                        <Text style={s.brandText}>
                            pdf<Text style={{ fontWeight: "400" }}>kit</Text>
                            <Text style={{ color: "#84A37A" }}>.</Text>
                        </Text>
                    </View>
                    <Text style={s.sidebarCaption}>
                        TU ESPACIO DE DOCUMENTOS
                    </Text>
                    <View style={{ gap: 7 }}>
                        {applicationTabs.map(({ id, label, icon: Icon }) => (
                            <Pressable
                                key={id}
                                onPress={() => navigate(id)}
                                style={({ pressed }) => [
                                    s.navItem,
                                    active === id && s.navActive,
                                    pressed && { opacity: 0.7 },
                                ]}
                            >
                                <Icon
                                    size={20}
                                    color={active === id ? green : "#7D8780"}
                                    strokeWidth={1.7}
                                />
                                <Text
                                    style={[
                                        s.navLabel,
                                        active === id && {
                                            color: green,
                                            fontWeight: "600",
                                        },
                                    ]}
                                >
                                    {label}
                                </Text>
                                {id === "files" && (
                                    <Text style={s.count}>
                                        {documents.length}
                                    </Text>
                                )}
                                {active === id && <View style={s.navDot} />}
                            </Pressable>
                        ))}
                    </View>
                    <View style={{ flex: 1 }} />
                    <View style={s.localCard}>
                        <View style={s.row}>
                            <ShieldCheck size={20} color={green} />
                            <Text style={s.localTitle}>
                                Tus archivos, a salvo
                            </Text>
                        </View>
                        <Text style={s.localText}>
                            {
                                "Se quedan en tu dispositivo.\nTu privacidad va primero."
                            }
                        </Text>
                        <View style={s.localBadge}>
                            <View style={s.dot} />
                            <Text style={s.localBadgeText}>100% local</Text>
                        </View>
                    </View>
                    <Pressable style={s.help} onPress={showHelp}>
                        <View style={s.helpIcon}>
                            <Text style={{ color: "#7A837C", fontSize: 12 }}>
                                ?
                            </Text>
                        </View>
                        <Text style={s.muted}>Ayuda y consejos</Text>
                        <ChevronRight size={15} color="#91988F" />
                    </Pressable>
                    <View style={s.sidebarFooter}>
                        <View style={s.avatar}>
                            <Text
                                style={{
                                    color: green,
                                    fontWeight: "700",
                                    fontSize: 13,
                                }}
                            >
                                TÚ
                            </Text>
                        </View>
                        <View>
                            <Text style={s.profileTitle}>
                                Mi espacio personal
                            </Text>
                            <Text style={s.profileSubtitle}>
                                Todo en orden, todo a mano
                            </Text>
                        </View>
                    </View>
                </View>
            )}
            <View style={s.main}>
                <View testID="app-header" style={[s.topbar, compact && { paddingHorizontal: 22 }]}>
                    <View style={s.row}>
                        {!desktop && (
                            <View
                                style={[
                                    s.brandIcon,
                                    { width: 31, height: 34, borderRadius: 9 },
                                ]}
                            >
                                <Files size={20} color="white" />
                            </View>
                        )}
                        <Text style={s.breadcrumb}>
                            {desktop ? "Mi espacio" : "pdfkit."}
                        </Text>
                        <ChevronRight size={13} color="#AFB4AC" />
                        <Text style={s.breadcrumbActive}>
                            {applicationTabs.find((n) => n.id === active)?.label}
                        </Text>
                    </View>
                    <View style={s.row}>
                        {!compact && (
                            <View style={s.privatePill}>
                                <LockKeyhole size={12} color="#75836F" />
                                <Text style={s.privateText}>
                                    Espacio privado
                                </Text>
                            </View>
                        )}
                        <Pressable
                            accessibilityLabel="Ayuda y consejos"
                            onPress={showHelp}
                            style={[s.avatar, { height: 32, width: 32 }]}
                        >
                            <Text
                                style={{
                                    color: green,
                                    fontWeight: "600",
                                    fontSize: 12,
                                }}
                            >
                                TÚ
                            </Text>
                        </Pressable>
                    </View>
                </View>
                {children}
            </View>
        </SafeAreaView>
    )
}
