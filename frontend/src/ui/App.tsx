import React from "react";
import { HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Layout, Menu } from "antd";
import { OnboardingPage } from "./pages/OnboardingPage";
import { DatasetsPage } from "./pages/DatasetsPage";
import { IndicatorsPage } from "./pages/IndicatorsPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ComputePage } from "./pages/ComputePage";
import { ResultsPage } from "./pages/ResultsPage";

const { Sider, Content, Header } = Layout;

function Shell() {
  const location = useLocation();
  const selectedKey = location.pathname.split("/")[1] || "onboarding";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220}>
        <div style={{ height: 48, color: "white", fontSize: 16, display: "flex", alignItems: "center", paddingLeft: 16 }}>
          Indicator
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]}>
          <Menu.Item key="onboarding">
            <Link to="/">快速开始</Link>
          </Menu.Item>
          <Menu.Item key="datasets">
            <Link to="/datasets">数据集</Link>
          </Menu.Item>
          <Menu.Item key="indicators">
            <Link to="/indicators">指标库</Link>
          </Menu.Item>
          <Menu.Item key="models">
            <Link to="/models">权重模型</Link>
          </Menu.Item>
          <Menu.Item key="compute">
            <Link to="/compute">计算</Link>
          </Menu.Item>
          <Menu.Item key="results">
            <Link to="/results">结果</Link>
          </Menu.Item>
        </Menu>
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", padding: "0 16px" }}>
          <div style={{ fontWeight: 600 }}>离线指数计算器</div>
        </Header>
        <Content style={{ padding: 16 }}>
          <Routes>
            <Route path="/" element={<OnboardingPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/indicators" element={<IndicatorsPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/compute" element={<ComputePage />} />
            <Route path="/results" element={<ResultsPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

