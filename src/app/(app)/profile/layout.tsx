export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  // Consistent padding + max width for all /profile/* routes.
  return <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8">{children}</div>
}
