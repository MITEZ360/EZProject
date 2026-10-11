// scenarios/generic-cms/admin/src/components/MediaPicker.tsx
// 媒体选择器：把"手输资产 ID"换成"缩略图网格里挑 / 直接上传"。
//
// 注意：管理端列表接口返回的 Asset 不含 url（只有上传响应里拼了），
// 故这里统一按公开下载端点 /api/v1/assets/:id 自行拼装。

import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Image, Input, Modal, Space, Spin, Typography, message } from 'antd';
import { FileOutlined, UploadOutlined } from '@ant-design/icons';
import { ApiError, assetsApi, type AssetItem } from '../lib/api';

interface Props {
  value?: string;
  onChange?: (v: string | undefined) => void;
  disabled?: boolean;
}

const urlOf = (a: AssetItem): string => a.url ?? `/api/v1/assets/${a.id}`;
const isImage = (a: AssetItem): boolean => a.contentType?.startsWith('image/') ?? false;
const shortId = (id: string): string => `${id.slice(0, 8)}…`;

export default function MediaPicker({ value, onChange, disabled }: Props) {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setAssets((await assetsApi.list()).items);
    } catch (e) {
      void message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 预加载一次：既能显示当前选中资产的文件名，也让选择弹窗秒开
  useEffect(() => {
    void load();
  }, [load]);

  const current = assets.find((a) => a.id === value);
  // 资产未加载完 / 已被删除时，退回显示 id 前缀（不显示空白）
  const currentLabel = current?.filename ?? (value ? shortId(value) : '');

  const upload = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const asset = await assetsApi.upload(file);
      await load();
      onChange?.(asset.id);
      setOpen(false);
      void message.success(`已上传并选中：${asset.filename}`);
    } catch (e) {
      void message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setUploading(false);
    }
  };

  const pickFile = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void upload(file);
    };
    input.click();
  };

  return (
    <div>
      <Space.Compact style={{ width: '100%' }}>
        <Input value={currentLabel} readOnly placeholder="未选择资产" disabled={disabled} />
        <Button onClick={() => setOpen(true)} disabled={disabled}>
          {value ? '更换' : '选择'}
        </Button>
        {value && (
          <Button danger onClick={() => onChange?.(undefined)} disabled={disabled}>
            清除
          </Button>
        )}
      </Space.Compact>
      {current && isImage(current) && (
        <Image src={urlOf(current)} height={64} style={{ marginTop: 8, objectFit: 'cover' }} />
      )}

      <Modal
        title="选择资产"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<UploadOutlined />} loading={uploading} onClick={pickFile}>
            上传新资产
          </Button>
          <Button loading={loading} onClick={() => void load()}>
            刷新
          </Button>
          <Typography.Text type="secondary">共 {assets.length} 个</Typography.Text>
        </Space>

        {loading && assets.length === 0 ? (
          <Spin />
        ) : assets.length === 0 ? (
          <Empty description="媒体库为空，先上传一个" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              maxHeight: 420,
              overflow: 'auto',
            }}
          >
            {assets.map((a) => (
              <div
                key={a.id}
                onClick={() => {
                  onChange?.(a.id);
                  setOpen(false);
                }}
                style={{
                  border: a.id === value ? '2px solid #c0392b' : '1px solid #eee',
                  borderRadius: 6,
                  padding: 8,
                  cursor: 'pointer',
                  textAlign: 'center',
                  height: 124,
                }}
              >
                <div
                  style={{
                    height: 72,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isImage(a) ? (
                    <Image src={urlOf(a)} height={72} style={{ objectFit: 'cover' }} preview={false} />
                  ) : (
                    <FileOutlined style={{ fontSize: 28, color: '#999' }} />
                  )}
                </div>
                <div
                  title={a.filename}
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {a.filename}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
