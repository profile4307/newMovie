'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { api, type Comment } from '@/lib/api'
import { supabase } from '@/lib/supabase'

// textarea 높이를 내용에 맞게 자동 조정
function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}일 전`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}개월 전` : `${Math.floor(months / 12)}년 전`
}

function Avatar({ user }: { user: Comment['user'] }) {
  return (
    <div className="w-8 h-8 rounded-full bg-sky-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
      {user.avatar_url ? (
        <Image src={user.avatar_url} alt={user.username} width={32} height={32} className="object-cover" />
      ) : (
        <span className="text-sky-500 font-semibold text-sm">{user.username[0]?.toUpperCase()}</span>
      )}
    </div>
  )
}

// ─── 대댓글 영역 ──────────────────────────────────────────────────────────
function ReplySection({
  parentId,
  videoId,
  currentUserId,
  onCountChange,
}: {
  parentId: string
  videoId: string
  currentUserId: string | null
  onCountChange: (delta: number) => void
}) {
  const [replies, setReplies] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.comments.replies(parentId)
      .then((r) => setReplies(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [parentId])

  async function submitReply() {
    if (!replyText.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await api.comments.create({ video_id: videoId, content: replyText.trim(), parent_id: parentId })
      setReplies((prev) => [...prev, res.data])
      onCountChange(+1)
      setReplyText('')
      if (replyTextareaRef.current) {
        replyTextareaRef.current.style.height = 'auto'
      }
    } catch { /* ignore */ } finally {
      setSubmitting(false)
    }
  }

  async function deleteReply(id: string) {
    if (!confirm('이 답글을 삭제하시겠습니까?')) return
    await api.comments.delete(id)
    setReplies((prev) => prev.filter((r) => r.id !== id))
    onCountChange(-1)
  }

  return (
    <div className="ml-10 mt-2 space-y-3">
      {loading ? (
        <p className="text-xs text-slate-400">불러오는 중...</p>
      ) : (
        replies.map((reply) => (
          <div key={reply.id} className="flex gap-2 group">
            <Avatar user={reply.user} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-800">{reply.user.username}</span>
                <span className="text-xs text-slate-400">{timeAgo(reply.created_at)}</span>
              </div>
              <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{reply.content}</p>
            </div>
            {currentUserId === reply.user.id && (
              <button
                onClick={() => deleteReply(reply.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-400 text-xs flex-shrink-0"
              >
                삭제
              </button>
            )}
          </div>
        ))
      )}

      {/* 대댓글 입력 */}
      {currentUserId && (
        <div className="flex gap-2 pt-1">
          <div className="w-7 h-7 rounded-full bg-sky-100 flex-shrink-0" />
          <div className="flex-1 flex gap-2 items-end">
            <textarea
              ref={replyTextareaRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onInput={(e) => autoResize(e.currentTarget)}
              placeholder="답글 추가..."
              maxLength={2000}
              rows={1}
              className="flex-1 text-sm bg-transparent border-b border-slate-200 focus:border-sky-400 outline-none py-1 placeholder-slate-300 text-slate-800 transition-colors resize-none overflow-hidden"
            />
            <button
              onClick={submitReply}
              disabled={!replyText.trim() || submitting}
              className="text-xs font-semibold text-sky-500 hover:text-sky-700 disabled:text-slate-300 transition-colors flex-shrink-0"
            >
              {submitting ? '...' : '등록'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 단일 댓글 ───────────────────────────────────────────────────────────
function CommentItem({
  comment,
  videoId,
  currentUserId,
  onDelete,
}: {
  comment: Comment
  videoId: string
  currentUserId: string | null
  onDelete: (id: string) => void
}) {
  const [showReplies, setShowReplies] = useState(false)
  // 초기값: 저장된 reply_count 컬럼, 클릭 후엔 실제 로드 결과로 갱신
  const [replyCount, setReplyCount] = useState<number>(comment.reply_count ?? 0)
  const [loadedOnce, setLoadedOnce] = useState(false)

  function toggleReplies() {
    setShowReplies((v) => !v)
    if (!loadedOnce) {
      setLoadedOnce(true)
      api.comments.replies(comment.id)
        .then((r) => setReplyCount(r.data.length))
        .catch(() => {})
    }
  }

  return (
    <div className="group">
      <div className="flex gap-3">
        <Avatar user={comment.user} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800">{comment.user.username}</span>
            <span className="text-xs text-slate-400">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">{comment.content}</p>

          {/* 답글 토글 버튼 */}
          <button
            onClick={toggleReplies}
            className="mt-1.5 text-xs text-sky-500 hover:text-sky-700 font-medium transition-colors"
          >
            {showReplies
              ? '답글 접기'
              : replyCount > 0
              ? `답글 ${replyCount}개 보기`
              : '답글'}
          </button>
        </div>

        {currentUserId === comment.user.id && (
          <button
            onClick={() => onDelete(comment.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-400 text-xs flex-shrink-0 self-start pt-1"
          >
            삭제
          </button>
        )}
      </div>

      {showReplies && (
        <ReplySection
          parentId={comment.id}
          videoId={videoId}
          currentUserId={currentUserId}
          onCountChange={(delta) => setReplyCount((n) => Math.max(0, n + delta))}
        />
      )}
    </div>
  )
}

// ─── 메인 CommentSection ─────────────────────────────────────────────────
export function CommentSection({ videoId, initialCommentCount = 0 }: { videoId: string; initialCommentCount?: number }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [commentCount, setCommentCount] = useState(initialCommentCount)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const mainTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data.session?.user.id ?? null)
    })
  }, [])

  const loadComments = useCallback(async (p: number, append = false) => {
    try {
      const res = await api.comments.list(videoId, p)
      const fetched = res.data
      if (append) {
        setComments((prev) => [...prev, ...fetched])
      } else {
        setComments(fetched)
      }
      setHasMore(fetched.length === 20)
    } catch { /* ignore */ } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [videoId])

  useEffect(() => {
    loadComments(1)
  }, [loadComments])

  async function loadMore() {
    setLoadingMore(true)
    const next = page + 1
    setPage(next)
    await loadComments(next, true)
  }

  async function submitComment() {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await api.comments.create({ video_id: videoId, content: text.trim() })
      setComments((prev) => [res.data, ...prev])
      setCommentCount((n) => n + 1)
      setText('')
      if (mainTextareaRef.current) {
        mainTextareaRef.current.style.height = 'auto'
      }
    } catch { /* ignore */ } finally {
      setSubmitting(false)
    }
  }

  async function deleteComment(id: string) {
    if (!confirm('이 댓글을 삭제하시겠습니까?')) return
    await api.comments.delete(id)
    setComments((prev) => prev.filter((c) => c.id !== id))
    setCommentCount((n) => Math.max(0, n - 1))
  }

  return (
    <div className="mt-6 bg-white rounded-2xl p-5 shadow-sm border border-sky-100">
      <h3 className="font-bold text-slate-800 mb-5">
        댓글 {commentCount > 0 && <span className="text-slate-400 font-normal text-sm">{commentCount}개</span>}
      </h3>

      {/* 댓글 입력 */}
      {currentUserId ? (
        <div className="flex gap-3 mb-6">
          <div className="w-8 h-8 rounded-full bg-sky-100 flex-shrink-0" />
          <div className="flex-1">
            <textarea
              ref={mainTextareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onInput={(e) => autoResize(e.currentTarget)}
              placeholder="댓글 추가..."
              maxLength={2000}
              rows={1}
              className="w-full text-sm bg-transparent border-b border-slate-200 focus:border-sky-400 outline-none py-1 placeholder-slate-300 text-slate-800 transition-colors resize-none overflow-hidden"
            />
            <div className="flex justify-end mt-2 gap-2">
              <button
                onClick={() => setText('')}
                className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={submitComment}
                disabled={!text.trim() || submitting}
                className="text-xs font-semibold bg-sky-500 hover:bg-sky-600 disabled:bg-sky-200 disabled:text-sky-400 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {submitting ? '등록 중...' : '댓글 등록'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400 mb-6 pb-4 border-b border-sky-50">
          댓글을 작성하려면 <a href="/login" className="text-sky-500 hover:underline">로그인</a>하세요
        </p>
      )}

      {/* 댓글 목록 */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">첫 댓글을 작성해보세요</p>
      ) : (
        <div className="space-y-5">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              videoId={videoId}
              currentUserId={currentUserId}
              onDelete={deleteComment}
            />
          ))}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full text-sm text-sky-500 hover:text-sky-700 py-2 transition-colors disabled:text-slate-300"
            >
              {loadingMore ? '불러오는 중...' : '댓글 더 보기'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
