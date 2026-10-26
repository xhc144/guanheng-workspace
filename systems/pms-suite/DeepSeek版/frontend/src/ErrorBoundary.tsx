import React from 'react';
import { Result, Button } from 'antd';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return <Result status="error" title="页面出现错误" subTitle={this.state.error?.message}
        extra={<Button type="primary" onClick={() => this.setState({ hasError: false })}>重试</Button>} />;
    }
    return this.props.children;
  }
}
