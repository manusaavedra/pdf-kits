import { Tabs } from "expo-router"
import { useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ApplicationShell } from "@/components/application-shell"
import { DocumentActionsProvider } from "@/components/document-actions"
import { green } from "@/components/pdf-styles"
import { applicationTabs } from "@/lib/app-navigation"

export default function TabsLayout() {
    const { width } = useWindowDimensions()
    const desktop = width >= 1000
    const insets = useSafeAreaInsets()

    return (
        <DocumentActionsProvider>
            <ApplicationShell>
                <Tabs
                    initialRouteName="index"
                    backBehavior="history"
                    detachInactiveScreens
                    safeAreaInsets={{ top: 0, left: 0, right: 0, bottom: desktop ? 0 : insets.bottom }}
                    screenOptions={{
                        headerShown: false,
                        animation: "none",
                        lazy: true,
                        freezeOnBlur: true,
                        sceneStyle: { backgroundColor: "#FAFBF7" },
                        tabBarActiveTintColor: green,
                        tabBarInactiveTintColor: "#96A090",
                        tabBarActiveBackgroundColor: "#EAF0E3",
                        tabBarInactiveBackgroundColor: "transparent",
                        tabBarLabelPosition: "below-icon",
                        tabBarHideOnKeyboard: false,
                        tabBarLabelStyle: { fontSize: 10, fontWeight: "500", marginTop: 3 },
                        tabBarItemStyle: { borderRadius: 8, marginHorizontal: 4 },
                        tabBarStyle: desktop ? { display: "none" } : {
                            height: 68 + insets.bottom,
                            paddingTop: 8,
                            paddingBottom: 8 + insets.bottom,
                            backgroundColor: "#FAFCF6",
                            borderTopColor: "#E4EADD",
                            elevation: 0,
                            boxShadow: "none",
                        },
                    }}
                >
                    {applicationTabs.map(({ name, label, icon: Icon }) => (
                        <Tabs.Screen
                            key={name}
                            name={name}
                            options={{
                                title: label,
                                tabBarAccessibilityLabel: label,
                                tabBarButtonTestID: `tab-${name}`,
                                tabBarIcon: ({ color, focused }) => (
                                    <Icon size={20} color={color} strokeWidth={focused ? 2 : 1.6} />
                                ),
                            }}
                        />
                    ))}
                </Tabs>
            </ApplicationShell>
        </DocumentActionsProvider>
    )
}
