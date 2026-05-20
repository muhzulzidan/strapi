import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackButton,
  Layouts,
  Page,
  useAPIErrorHandler,
  useFetchClient,
  useNotification,
} from '@strapi/strapi/admin';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  IconButton,
  Main,
  MultiSelect,
  MultiSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise, Check, Minus, Play, Plus, Trash } from '@strapi/icons';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';

type HeaderRow = {
  key: string;
  value: string;
};

type WebhookResponse = {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  events: string[];
  contentTypes?: string[];
};

type ContentTypeOption = {
  uid: string;
  displayName: string;
};

type FormValues = {
  name: string;
  url: string;
  headers: HeaderRow[];
  events: string[];
  contentTypes: string[];
};

type Mode = 'create' | 'edit';

const EMPTY_HEADER_ROW: HeaderRow = { key: '', value: '' };

const EVENT_GROUPS: Record<string, string[]> = {
  entry: ['entry.create', 'entry.update', 'entry.delete', 'entry.publish', 'entry.unpublish'],
  media: ['media.create', 'media.update', 'media.delete'],
};

const EMPTY_FORM: FormValues = {
  name: '',
  url: '',
  headers: [EMPTY_HEADER_ROW],
  events: [],
  contentTypes: [],
};

const hasEntryEvents = (events: string[]): boolean => {
  return events.some((event) => event.startsWith('entry.'));
};

const mapHeadersToRows = (headers?: Record<string, string>): HeaderRow[] => {
  if (!headers || Object.keys(headers).length === 0) {
    return [EMPTY_HEADER_ROW];
  }

  return Object.entries(headers).map(([key, value]) => ({ key, value }));
};

const mapRowsToHeaders = (rows: HeaderRow[]): Record<string, string> => {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim();
    if (!key) {
      return acc;
    }

    acc[key] = row.value;
    return acc;
  }, {});
};

const toWebhookForm = (webhook: WebhookResponse): FormValues => {
  return {
    name: webhook.name || '',
    url: webhook.url || '',
    headers: mapHeadersToRows(webhook.headers),
    events: Array.isArray(webhook.events) ? webhook.events : [],
    contentTypes: Array.isArray(webhook.contentTypes) ? webhook.contentTypes : [],
  };
};

const eventLabel = (event: string): string => {
  const [, action] = event.split('.');
  return action
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const groupLabel = (group: string): string => {
  return group.charAt(0).toUpperCase() + group.slice(1);
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const maybeError = error as { message?: string };
    if (typeof maybeError.message === 'string' && maybeError.message.trim().length > 0) {
      return maybeError.message;
    }
  }

  return fallback;
};

type DeliveryRow = {
  id: number;
  event: string;
  modelUid: string | null;
  statusCode: number | null;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  requestPayload: string | null;
  responseBody: string | null;
  createdAt: string;
};

const prettyJson = (raw: string | null | undefined): string => {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

const formatDateTime = (value: string): string => {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  } catch {
    return value;
  }
};

const CustomWebhookPage = ({ mode }: { mode: Mode }) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const { get, post, put, del } = useFetchClient();
  const { _unstableFormatAPIError: formatAPIError } = useAPIErrorHandler();
  const { id } = useParams();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const [contentTypeOptions, setContentTypeOptions] = useState<ContentTypeOption[]>([]);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [isLoadingDeliveries, setIsLoadingDeliveries] = useState(false);
  const [isClearingDeliveries, setIsClearingDeliveries] = useState(false);
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<number | null>(null);

  const pageTitle =
    mode === 'create'
      ? formatMessage({ id: 'Settings.webhooks.create', defaultMessage: 'Create a webhook' })
      : formatMessage({ id: 'Settings.webhooks.edit', defaultMessage: 'Edit webhook' });

  const canTrigger = mode === 'edit' && Boolean(id);

  const hasSaveableData = useMemo(() => {
    return form.name.trim().length > 0 && form.url.trim().length > 0 && form.events.length > 0;
  }, [form.name, form.url, form.events.length]);

  const loadData = useCallback(async () => {
    setIsLoading(true);

    try {
      const [{ data: contentTypesRes }, webhookRes] = await Promise.all([
        // Use the content-manager's existing endpoint to list available content types.
        // Response: { data: [{ uid, kind, isDisplayed, info: { displayName } }] }
        get('/content-manager/content-types'),
        mode === 'edit' && id ? get(`/admin/webhooks/${id}`) : Promise.resolve(undefined),
      ]);

      const options: ContentTypeOption[] = Array.isArray(contentTypesRes?.data)
        ? contentTypesRes.data
            // Only include api:: content types (collection/single); skip admin/plugin internals
            .filter((item: any) => typeof item.uid === 'string' && item.uid.startsWith('api::'))
            .map((item: any) => ({
              uid: item.uid,
              // content-manager DTO nests displayName inside the info object
              displayName: item.info?.displayName || item.apiID || item.uid,
            }))
        : [];

      setContentTypeOptions(options);

      if (mode === 'edit' && webhookRes?.data?.data) {
        setForm(toWebhookForm(webhookRes.data.data as WebhookResponse));
      } else {
        setForm(EMPTY_FORM);
      }
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: formatAPIError(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, [formatAPIError, get, id, mode, toggleNotification]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadDeliveries = useCallback(async () => {
    if (mode !== 'edit' || !id) {
      return;
    }
    setIsLoadingDeliveries(true);
    try {
      const response = await get(`/admin/webhooks/${id}/deliveries`, { params: { limit: 100 } });
      const rows = Array.isArray(response?.data?.data) ? (response.data.data as DeliveryRow[]) : [];
      setDeliveries(rows);
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: toErrorMessage(formatAPIError(error), 'Failed to load deliveries.'),
      });
    } finally {
      setIsLoadingDeliveries(false);
    }
  }, [formatAPIError, get, id, mode, toggleNotification]);

  const clearDeliveries = useCallback(async () => {
    if (mode !== 'edit' || !id) {
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm('Clear all delivery logs for this webhook?')) {
      return;
    }
    setIsClearingDeliveries(true);
    try {
      await del(`/admin/webhooks/${id}/deliveries`);
      setDeliveries([]);
      toggleNotification({
        type: 'success',
        message: formatMessage({
          id: 'Settings.webhooks.deliveries.cleared',
          defaultMessage: 'Delivery log cleared',
        }),
      });
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: toErrorMessage(formatAPIError(error), 'Failed to clear deliveries.'),
      });
    } finally {
      setIsClearingDeliveries(false);
    }
  }, [del, formatAPIError, formatMessage, id, mode, toggleNotification]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const setHeaderRow = (index: number, next: HeaderRow) => {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.map((row, rowIndex) => (rowIndex === index ? next : row)),
    }));
  };

  const addHeaderRow = () => {
    setForm((prev) => ({
      ...prev,
      headers: [...prev.headers, { ...EMPTY_HEADER_ROW }],
    }));
  };

  const removeHeaderRow = (index: number) => {
    setForm((prev) => {
      const nextRows = prev.headers.filter((_row, rowIndex) => rowIndex !== index);
      return {
        ...prev,
        headers: nextRows.length > 0 ? nextRows : [{ ...EMPTY_HEADER_ROW }],
      };
    });
  };

  const toggleEvent = (event: string, checked: boolean) => {
    setForm((prev) => {
      const set = new Set(prev.events);
      if (checked) {
        set.add(event);
      } else {
        set.delete(event);
      }

      return {
        ...prev,
        events: Array.from(set),
      };
    });
  };

  const submit = async () => {
    if (!hasSaveableData) {
      toggleNotification({
        type: 'danger',
        message: formatMessage({
          id: 'Settings.webhooks.validation.base',
          defaultMessage: 'Name, URL, and at least one event are required.',
        }),
      });
      return;
    }

    // Safer behavior for this extension: if any entry event is selected,
    // at least one content type must be selected to avoid accidental broad dispatch.
    if (hasEntryEvents(form.events) && form.contentTypes.length === 0) {
      toggleNotification({
        type: 'danger',
        message: formatMessage({
          id: 'Settings.webhooks.validation.contentTypes.required',
          defaultMessage: 'Select at least one content type when entry events are enabled.',
        }),
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        headers: mapRowsToHeaders(form.headers),
        events: form.events,
        contentTypes: form.contentTypes,
      };

      if (mode === 'create') {
        const response = await post('/admin/webhooks', payload);
        const createdId = response?.data?.data?.id;

        toggleNotification({
          type: 'success',
          message: formatMessage({
            id: 'Settings.webhooks.created',
            defaultMessage: 'Webhook created',
          }),
        });

        if (createdId) {
          navigate(`../webhooks/${createdId}`, { replace: true });
        }
      } else if (id) {
        await put(`/admin/webhooks/${id}`, payload);

        toggleNotification({
          type: 'success',
          message: formatMessage({
            id: 'notification.form.success.fields',
            defaultMessage: 'Saved',
          }),
        });
      }
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: toErrorMessage(formatAPIError(error), 'Failed to save webhook.'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerWebhook = async () => {
    if (!id) {
      return;
    }

    setIsTriggering(true);
    setTriggerMessage(null);

    try {
      const response = await post(`/admin/webhooks/${id}/trigger`);
      const statusCode = response?.data?.data?.statusCode;
      const message = response?.data?.data?.message;

      if (typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300) {
        const text = formatMessage(
          {
            id: 'Settings.webhooks.trigger.custom.success',
            defaultMessage: 'Trigger success ({statusCode})',
          },
          { statusCode }
        );

        setTriggerMessage(text);

        toggleNotification({
          type: 'success',
          message: text,
        });
      } else {
        const text = message ||
          formatMessage(
            {
              id: 'Settings.webhooks.trigger.custom.failed',
              defaultMessage: 'Trigger failed ({statusCode})',
            },
            { statusCode: statusCode ?? 'unknown' }
          );

        setTriggerMessage(text);

        toggleNotification({
          type: 'danger',
          message: text,
        });
      }
    } catch (error) {
      const text = toErrorMessage(formatAPIError(error), 'Failed to trigger webhook.');
      setTriggerMessage(text);

      toggleNotification({
        type: 'danger',
        message: text,
      });
    } finally {
      setIsTriggering(false);
    }
  };

  if (isLoading) {
    return <Page.Loading />;
  }

  return (
    <Main>
      <Page.Title>
        {formatMessage(
          {
            id: 'Settings.PageTitle',
            defaultMessage: 'Settings - {name}',
          },
          { name: 'Webhooks' }
        )}
      </Page.Title>

      <Layouts.Header
        title={pageTitle}
        navigationAction={
          <Box display={{ initial: 'none', medium: 'block' }}>
            <BackButton fallback="../webhooks" />
          </Box>
        }
        primaryAction={
          <Flex gap={2}>
            <Button
              variant="tertiary"
              startIcon={<Play />}
              disabled={!canTrigger || isTriggering || isSubmitting}
              loading={isTriggering}
              onClick={triggerWebhook}
            >
              {formatMessage({ id: 'Settings.webhooks.trigger', defaultMessage: 'Trigger' })}
            </Button>
            <Button
              startIcon={<Check />}
              disabled={!hasSaveableData || isSubmitting}
              loading={isSubmitting}
              onClick={submit}
            >
              {formatMessage({ id: 'global.save', defaultMessage: 'Save' })}
            </Button>
          </Flex>
        }
      />


      <Layouts.Content>
        {/* Centered max-width wrapper — keeps the form readable on very wide screens */}
        <Box style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {triggerMessage ? (
              <Alert closeLabel="Close" onClose={() => setTriggerMessage(null)} title={triggerMessage} />
            ) : null}

            <Box background="neutral0" padding={8} shadow="filterShadow" hasRadius>
              <Flex direction="column" alignItems="stretch" gap={6}>

                {/* Name — full width */}
                <Field.Root name="name" required>
                  <Field.Label>
                    {formatMessage({ id: 'global.name', defaultMessage: 'Name' })}
                  </Field.Label>
                  <TextInput
                    value={form.name}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                  />
                </Field.Root>

                {/* URL — full width */}
                <Field.Root name="url" required>
                  <Field.Label>
                    {formatMessage({ id: 'Settings.webhooks.form.url', defaultMessage: 'Url' })}
                  </Field.Label>
                  <TextInput
                    value={form.url}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setForm((prev) => ({ ...prev, url: event.target.value }))
                    }
                  />
                </Field.Root>

                {/* Headers — Key/Value in 1fr 1fr auto CSS grid */}
                <Field.Root name="headers">
                  <Field.Label>
                    {formatMessage({ id: 'Settings.webhooks.form.headers', defaultMessage: 'Headers' })}
                  </Field.Label>

                  <Flex direction="column" alignItems="stretch" gap={2}>
                    {form.headers.map((row, index) => (
                      <Box
                        key={`header-row-${index}`}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'end' }}
                      >
                        <TextInput
                          value={row.key}
                          placeholder={formatMessage({ id: 'Settings.webhooks.key', defaultMessage: 'Key' })}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                            setHeaderRow(index, { ...row, key: event.target.value })
                          }
                        />
                        <TextInput
                          value={row.value}
                          placeholder={formatMessage({ id: 'Settings.webhooks.value', defaultMessage: 'Value' })}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                            setHeaderRow(index, { ...row, value: event.target.value })
                          }
                        />
                        <IconButton
                          onClick={() => removeHeaderRow(index)}
                          label={formatMessage({ id: 'Settings.webhooks.headers.remove', defaultMessage: 'Remove header' })}
                        >
                          <Minus />
                        </IconButton>
                      </Box>
                    ))}

                    <Box>
                      <Button variant="ghost" onClick={addHeaderRow} startIcon={<Plus />}>
                        {formatMessage({ id: 'Settings.webhooks.create.header', defaultMessage: 'Create new header' })}
                      </Button>
                    </Box>
                  </Flex>
                </Field.Root>

                {/* Events — full-width groups, checkboxes wrap on small screens */}
                <Field.Root name="events" required>
                  <Field.Label>
                    {formatMessage({ id: 'Settings.webhooks.form.events', defaultMessage: 'Events' })}
                  </Field.Label>

                  <Flex direction="column" alignItems="stretch" gap={2}>
                    {Object.entries(EVENT_GROUPS).map(([group, events]) => (
                      <Box key={group} background="neutral100" padding={3} hasRadius style={{ width: '100%' }}>
                        <Flex direction="column" alignItems="flex-start" gap={2}>
                          <Typography fontWeight="semiBold" style={{ width: '100%' }}>
                            {groupLabel(group)}
                          </Typography>
                          <Box
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              justifyContent: 'flex-start',
                              alignItems: 'flex-start',
                              gap: '24px 32px',
                              width: '100%',
                            }}
                          >
                            {events.map((event) => (
                              <Checkbox
                                key={event}
                                name={event}
                                checked={form.events.includes(event)}
                                onCheckedChange={(checked) => toggleEvent(event, !!checked)}
                              >
                                {eventLabel(event)}
                              </Checkbox>
                            ))}
                          </Box>
                        </Flex>
                      </Box>
                    ))}
                  </Flex>
                </Field.Root>

                {/* Content types — full width */}
                <Field.Root name="contentTypes" required={hasEntryEvents(form.events)}>
                  <Field.Label>
                    {formatMessage({ id: 'Settings.webhooks.form.contentTypes', defaultMessage: 'Content types' })}
                  </Field.Label>

                  <MultiSelect
                    withTags
                    value={form.contentTypes}
                    onChange={(value) => setForm((prev) => ({ ...prev, contentTypes: value }))}
                    placeholder={formatMessage({ id: 'app.components.Select.placeholder', defaultMessage: 'Select' })}
                  >
                    {contentTypeOptions.map((option) => (
                      <MultiSelectOption key={option.uid} value={option.uid}>
                        {option.displayName}
                      </MultiSelectOption>
                    ))}
                  </MultiSelect>

                  <Field.Hint>
                    {formatMessage({
                      id: 'Settings.webhooks.form.contentTypes.hint',
                      defaultMessage: 'When any entry event is selected, only these content types can trigger this webhook.',
                    })}
                  </Field.Hint>
                </Field.Root>

              </Flex>
            </Box>

            {mode === 'edit' && id ? (
              <Box background="neutral0" padding={8} shadow="filterShadow" hasRadius>
                <Flex direction="column" alignItems="stretch" gap={4}>
                  <Flex justifyContent="space-between" alignItems="center" gap={2}>
                    <Typography variant="delta" tag="h2">
                      {formatMessage({
                        id: 'Settings.webhooks.deliveries.title',
                        defaultMessage: 'Deliveries',
                      })}
                    </Typography>
                    <Flex gap={2}>
                      <Button
                        variant="tertiary"
                        startIcon={<ArrowClockwise />}
                        loading={isLoadingDeliveries}
                        disabled={isLoadingDeliveries || isClearingDeliveries}
                        onClick={() => void loadDeliveries()}
                      >
                        {formatMessage({
                          id: 'Settings.webhooks.deliveries.refresh',
                          defaultMessage: 'Refresh',
                        })}
                      </Button>
                      <Button
                        variant="danger-light"
                        startIcon={<Trash />}
                        loading={isClearingDeliveries}
                        disabled={isLoadingDeliveries || isClearingDeliveries || deliveries.length === 0}
                        onClick={() => void clearDeliveries()}
                      >
                        {formatMessage({
                          id: 'Settings.webhooks.deliveries.clear',
                          defaultMessage: 'Clear',
                        })}
                      </Button>
                    </Flex>
                  </Flex>

                  {deliveries.length === 0 ? (
                    <Box padding={6} background="neutral100" hasRadius>
                      <Typography textColor="neutral600">
                        {isLoadingDeliveries
                          ? formatMessage({
                              id: 'Settings.webhooks.deliveries.loading',
                              defaultMessage: 'Loading deliveries...',
                            })
                          : formatMessage({
                              id: 'Settings.webhooks.deliveries.empty',
                              defaultMessage: 'No deliveries recorded yet. Trigger this webhook or save an entry of an allowed content type to generate one.',
                            })}
                      </Typography>
                    </Box>
                  ) : (
                    <Box style={{ overflowX: 'auto' }}>
                      <Table colCount={6} rowCount={deliveries.length + 1}>
                        <Thead>
                          <Tr>
                            <Th><Typography variant="sigma">Time</Typography></Th>
                            <Th><Typography variant="sigma">Event</Typography></Th>
                            <Th><Typography variant="sigma">Content type</Typography></Th>
                            <Th><Typography variant="sigma">Status</Typography></Th>
                            <Th><Typography variant="sigma">Duration</Typography></Th>
                            <Th><Typography variant="sigma">Message</Typography></Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {deliveries.map((row) => {
                            const statusText =
                              row.statusCode === null || row.statusCode === undefined
                                ? '—'
                                : String(row.statusCode);
                            const statusColor = row.success
                              ? 'success600'
                              : row.statusCode === 204
                                ? 'neutral600'
                                : 'danger600';
                            const isExpanded = expandedDeliveryId === row.id;
                            return (
                              <React.Fragment key={row.id}>
                                <Tr
                                  onClick={() => setExpandedDeliveryId(isExpanded ? null : row.id)}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <Td>
                                    <Typography textColor="neutral800">
                                      {formatDateTime(row.createdAt)}
                                    </Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor="neutral800">{row.event}</Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor="neutral600">
                                      {row.modelUid || '—'}
                                    </Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor={statusColor} fontWeight="semiBold">
                                      {statusText}
                                    </Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor="neutral600">
                                      {row.durationMs !== null && row.durationMs !== undefined
                                        ? `${row.durationMs} ms`
                                        : '—'}
                                    </Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor={row.success ? 'neutral600' : 'danger600'}>
                                      {row.errorMessage || (row.statusCode === 204 ? 'Skipped (content type filter)' : '')}
                                    </Typography>
                                  </Td>
                                </Tr>
                                {isExpanded ? (
                                  <Tr>
                                    <Td colSpan={6}>
                                      <Flex direction="column" alignItems="stretch" gap={3} padding={3}>
                                        <Box>
                                          <Typography variant="sigma" textColor="neutral600">
                                            Request payload (sent to your webhook URL)
                                          </Typography>
                                          <Box
                                            background="neutral100"
                                            padding={3}
                                            hasRadius
                                            marginTop={1}
                                            style={{
                                              maxHeight: '320px',
                                              overflow: 'auto',
                                              fontFamily: 'monospace',
                                              fontSize: '12px',
                                              whiteSpace: 'pre-wrap',
                                              wordBreak: 'break-all',
                                            }}
                                          >
                                            {prettyJson(row.requestPayload) || '(empty)'}
                                          </Box>
                                        </Box>
                                        <Box>
                                          <Typography variant="sigma" textColor="neutral600">
                                            Response body (from your webhook URL)
                                          </Typography>
                                          <Box
                                            background="neutral100"
                                            padding={3}
                                            hasRadius
                                            marginTop={1}
                                            style={{
                                              maxHeight: '320px',
                                              overflow: 'auto',
                                              fontFamily: 'monospace',
                                              fontSize: '12px',
                                              whiteSpace: 'pre-wrap',
                                              wordBreak: 'break-all',
                                            }}
                                          >
                                            {prettyJson(row.responseBody) || '(empty)'}
                                          </Box>
                                        </Box>
                                      </Flex>
                                    </Td>
                                  </Tr>
                                ) : null}
                              </React.Fragment>
                            );
                          })}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                </Flex>
              </Box>
            ) : null}
          </Flex>
        </Box>
      </Layouts.Content>
    </Main>
  );
};

// Access is enforced server-side by the admin::isAuthenticatedAdmin and
// admin::hasPermissions policies on the webhook API routes. Page.Protect
// is intentionally omitted here because it requires internal Redux selectors
// that are not part of the public @strapi/strapi/admin API.
export const ProtectedCustomWebhookCreatePage = () => {
  return <CustomWebhookPage mode="create" />;
};

export const ProtectedCustomWebhookEditPage = () => {
  return <CustomWebhookPage mode="edit" />;
};
