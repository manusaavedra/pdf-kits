import { FolderOpen, Grip, Heart, LayoutDashboard } from "lucide-react-native"

export const applicationTabs = [
    { id: "home", name: "index", href: "/", label: "Inicio", icon: LayoutDashboard },
    { id: "files", name: "files", href: "/files", label: "Mis documentos", icon: FolderOpen },
    { id: "tools", name: "tools", href: "/tools", label: "Herramientas", icon: Grip },
    { id: "favorites", name: "favorites", href: "/favorites", label: "Favoritos", icon: Heart },
] as const

export type TabSection = (typeof applicationTabs)[number]["id"]
