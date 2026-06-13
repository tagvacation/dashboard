import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { sql } from './db'
import { hashCode } from './otp'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      phone?: string | null
      image?: string | null
      role: 'admin' | 'user'
      plan: 'free' | 'hobby' | 'pro' | 'agency'
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    phone?: string | null
    role: 'admin' | 'user'
    plan: 'free' | 'hobby' | 'pro' | 'agency'
  }
}

const ADMIN_EMAIL = 'rajaman.ar3@gmail.com'
const MAX_OTP_ATTEMPTS = 5

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Email OTP',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || '').trim().toLowerCase()
        const code = String(credentials?.code || '').trim()
        if (!email || !/^\d{6}$/.test(code)) return null

        const [otp] = await sql<{
          mode: string; code_hash: string; name: string | null; phone: string | null
          attempts: number; expires_at: string
        }[]>`SELECT mode, code_hash, name, phone, attempts, expires_at FROM otp_codes WHERE email = ${email}`

        if (!otp) return null
        if (new Date(otp.expires_at).getTime() < Date.now()) {
          await sql`DELETE FROM otp_codes WHERE email = ${email}`
          return null
        }
        if (otp.attempts >= MAX_OTP_ATTEMPTS) {
          await sql`DELETE FROM otp_codes WHERE email = ${email}`
          return null
        }
        if (otp.code_hash !== hashCode(email, code)) {
          await sql`UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ${email}`
          return null
        }

        // Code verified — consume it and upsert the user.
        await sql`DELETE FROM otp_codes WHERE email = ${email}`
        const role = email === ADMIN_EMAIL ? 'admin' : 'user'
        const [dbUser] = await sql<{
          id: string; email: string; name: string | null; phone: string | null
          role: 'admin' | 'user'; plan: 'free' | 'hobby' | 'pro' | 'agency'
        }[]>`
          INSERT INTO users (email, name, phone, role, last_login_at)
          VALUES (${email}, ${otp.name}, ${otp.phone}, ${role}, NOW())
          ON CONFLICT (email) DO UPDATE SET
            name = COALESCE(users.name, EXCLUDED.name),
            phone = COALESCE(users.phone, EXCLUDED.phone),
            last_login_at = NOW()
          RETURNING id, email, name, phone, role, plan
        `

        return {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          phone: dbUser.phone,
          role: dbUser.role,
          plan: dbUser.plan,
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: the authorize() return value is available as `user`.
      const u = user as (typeof user & { id?: string; phone?: string | null; role?: 'admin' | 'user'; plan?: 'free' | 'hobby' | 'pro' | 'agency' }) | undefined
      if (u?.id) {
        token.userId = u.id
        token.phone = u.phone ?? null
        token.role = u.role ?? 'user'
        token.plan = u.plan ?? 'free'
      }
      return token
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId
        session.user.phone = token.phone ?? null
        session.user.role = token.role
        session.user.plan = token.plan
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET,
}
