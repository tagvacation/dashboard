import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { sql } from './db'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      image?: string | null
      role: 'admin' | 'user'
      plan: 'free' | 'hobby' | 'pro' | 'agency'
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    role: 'admin' | 'user'
    plan: 'free' | 'hobby' | 'pro' | 'agency'
  }
}

const ADMIN_EMAIL = 'rajaman.ar3@gmail.com'

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET || '',
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
          scope: 'openid email profile',
        },
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      // Upsert user in DB on first sign-in
      const role = user.email === ADMIN_EMAIL ? 'admin' : 'user'
      await sql`
        INSERT INTO users (email, name, image_url, role, last_login_at)
        VALUES (${user.email}, ${user.name ?? null}, ${user.image ?? null}, ${role}, NOW())
        ON CONFLICT (email) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, users.name),
          image_url = COALESCE(EXCLUDED.image_url, users.image_url),
          last_login_at = NOW()
      `
      return true
    },
    async jwt({ token, user }) {
      // First sign-in: enrich token with DB user data
      if (user?.email) {
        const [dbUser] = await sql<{ id: string; role: 'admin' | 'user'; plan: 'free' | 'hobby' | 'pro' | 'agency' }[]>`
          SELECT id, role, plan FROM users WHERE email = ${user.email}
        `
        if (dbUser) {
          token.userId = dbUser.id
          token.role = dbUser.role
          token.plan = dbUser.plan
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId
        session.user.role = token.role
        session.user.plan = token.plan
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET,
}
