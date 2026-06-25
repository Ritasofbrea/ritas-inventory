import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: "Rita's Inventory – Brea",
  description: 'Inventory management for Rita\'s Italian Ice, Brea location',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col" style={{ background: '#d4edda' }}>{children}</body>
    </html>
  )
}
