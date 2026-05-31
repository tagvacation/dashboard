import { NextRequest, NextResponse } from 'next/server'
import { listStoryFiles, getFileStream } from '@/lib/gcs'
import archiver from 'archiver'
import { PassThrough } from 'stream'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const storyId = params.id

  try {
    const files = await listStoryFiles(storyId)
    const relevantFiles = files.filter(f => f.type === 'video' || f.type === 'audio')

    if (relevantFiles.length === 0) {
      return NextResponse.json({ error: 'No files found' }, { status: 404 })
    }

    const archive = archiver('zip', { zlib: { level: 6 } })
    const pass = new PassThrough()
    archive.pipe(pass)

    for (const file of relevantFiles) {
      const fileName = file.name.split('/').pop()!
      const stream = await getFileStream(file.name)
      archive.append(stream as NodeJS.ReadableStream, { name: fileName })
    }

    archive.finalize()

    const chunks: Buffer[] = []
    for await (const chunk of pass) {
      chunks.push(Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${storyId}.zip"`,
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}
