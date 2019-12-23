package helm_actions

import (
	"github.com/openshift/console/pkg/helm_agent"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
)

func InstallChart(ns, name, url string) (interface{}, error) {
	cmd := action.NewInstall(helm_agent.GetActionConfigurations())
	cmd.Namespace = ns

	name,chart,err :=  cmd.NameAndChart([]string{name, url})
	if err != nil {
		return nil, err
	}
	cmd.ReleaseName = name

	cp, err := cmd.ChartPathOptions.LocateChart(chart, cli.New())
	if err != nil {
		return nil, err
	}

	ch, err := loader.Load(cp)
	if err != nil {
		return nil, err
	}

	release, err := cmd.Run(ch, nil)
	if err != nil {
		return nil, err
	}
	return release, nil
}
