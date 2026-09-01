/**
 * message_id LRU 去重。
 *
 * 飞书开放平台明确：事件可能重复推送，event_id 不可靠，必须按 message_id 去重。
 * Set 的迭代顺序即插入顺序，超容量淘汰最旧条目。
 */
export class MessageDeduper {
  private readonly seen = new Set<string>();
  private readonly capacity: number;

  constructor(capacity: number = 1000) {
    this.capacity = capacity;
  }

  /** 幂等添加：messageId 已存在时返回 false。 */
  checkAndAdd(messageId: string): boolean {
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    if (this.seen.size > this.capacity) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  has(messageId: string): boolean {
    return this.seen.has(messageId);
  }

  get size(): number {
    return this.seen.size;
  }
}
