/**
 * Content Version Tracking Service
 * Handles recording and managing content versions
 */

import type { Core } from '@strapi/strapi';

type ContentVersionUID = 'api::content-version.content-version';
const CONTENT_VERSION_UID: ContentVersionUID = 'api::content-version.content-version';

const service = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Get the next version number for an entry
   */
  async getNextVersionNumber(
    contentTypeUid: string,
    entryId: string,
    locale: string = 'en'
  ): Promise<number> {
    try {
      const lastVersion = await strapi.db.query(CONTENT_VERSION_UID as any).findOne({
        select: ['versionNumber'],
        where: {
          contentTypeUid,
          entryId,
          locale,
        },
        orderBy: [{ versionNumber: 'desc' }],
      });

      return (lastVersion?.versionNumber || 0) + 1;
    } catch (error) {
      console.error('Error getting next version number:', error);
      return 1;
    }
  },

  /**
   * Record a version of content
   */
  async recordVersion(
    contentTypeUid: string,
    entryId: string,
    locale: string = 'en',
    options: {
      actionType?: 'create' | 'update' | 'publish' | 'unpublish' | 'delete' | 'revert';
      previousData?: Record<string, any>;
      newData: Record<string, any>;
      publishedState?: boolean;
      draftState?: boolean;
      userId?: string;
      userEmail?: string;
      reason?: string;
      changedFields?: string[];
    }
  ): Promise<any> {
    try {
      const {
        actionType = 'update',
        previousData = {},
        newData = {},
        publishedState = false,
        draftState = true,
        userId,
        userEmail,
        reason,
        changedFields: providedChangedFields = [],
      } = options;

      // Get next version number
      const versionNumber = await this.getNextVersionNumber(contentTypeUid, entryId, locale);

      // If changedFields is empty, calculate it
      let fieldsChanged = providedChangedFields;
      if (!fieldsChanged || fieldsChanged.length === 0) {
        fieldsChanged = this.calculateChangedFields(previousData || {}, newData || {});
      }

      // Create version record
      const versionData = {
        contentTypeUid,
        entryId,
        locale,
        versionNumber,
        actionType,
        previousData,
        newData,
        changedFields: fieldsChanged,
        publishedState,
        draftState,
        userId,
        userEmail,
        reason,
      };

      const version = await strapi.entityService.create(CONTENT_VERSION_UID as any, {
        data: versionData,
      });

      return version;
    } catch (error) {
      console.error('Error recording version:', error);
      // Don't throw - we don't want versioning failures to break content updates
      return null;
    }
  },

  /**
   * Calculate which fields have changed
   */
  calculateChangedFields(
    previousData: Record<string, any> | undefined,
    newData: Record<string, any> | undefined
  ): string[] {
    const changed: Set<string> = new Set();
    const prev = previousData || {};
    const neu = newData || {};

    // Check existing keys
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(neu)]);

    for (const key of allKeys) {
      // Skip internal Strapi fields
      if (
        key.startsWith('_') ||
        key.startsWith('$') ||
        key === 'id' ||
        key === 'createdAt' ||
        key === 'updatedAt'
      ) {
        continue;
      }

      const oldValue = prev[key];
      const newValue = neu[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changed.add(key);
      }
    }

    return Array.from(changed);
  },

  /**
   * Get all versions for an entry
   */
  async getVersionHistory(
    contentTypeUid: string,
    entryId: string,
    locale: string = 'en'
  ): Promise<any[]> {
    try {
      const versions = await strapi.entityService.findMany(CONTENT_VERSION_UID as any, {
        filters: {
          contentTypeUid,
          entryId,
          locale,
        },
        sort: { versionNumber: 'desc' },
      });

      return (Array.isArray(versions) ? versions : []) as any[];
    } catch (error) {
      console.error('Error fetching version history:', error);
      return [];
    }
  },

  /**
   * Delete versions older than a certain age (optional cleanup)
   */
  async cleanupOldVersions(days: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result: any = await (strapi.db as any).query(CONTENT_VERSION_UID).deleteMany({
        where: {
          createdAt: {
            $lt: cutoffDate,
          },
        },
      });

      const count = result || 0;
      console.log(`Cleaned up ${count} old versions (older than ${days} days)`);
      return count;
    } catch (error) {
      console.error('Error cleaning up old versions:', error);
      return 0;
    }
  },

  /**
   * Get version statistics for an entry
   */
  async getVersionStats(contentTypeUid: string, entryId: string): Promise<any> {
    try {
      const stats: any = await (strapi.db as any).query(CONTENT_VERSION_UID).findMany({
        select: ['locale', 'actionType'],
        where: {
          contentTypeUid,
          entryId,
        },
      });

      const locales = new Set<string>();
      const actions = new Map<string, number>();

      for (const stat of stats || []) {
        locales.add(stat.locale || 'en');
        actions.set(stat.actionType, (actions.get(stat.actionType) || 0) + 1);
      }

      return {
        totalVersions: (stats || []).length,
        locales: Array.from(locales),
        actionCounts: Object.fromEntries(actions),
      };
    } catch (error) {
      console.error('Error getting version stats:', error);
      return null;
    }
  },
});

export default service;
