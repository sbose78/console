import * as _ from 'lodash-es';
import * as React from 'react';
import { Helmet } from 'react-helmet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionToggle,
  Button,
  Chip,
  ChipGroup,
  ChipGroupToolbarItem,
} from '@patternfly/react-core';
import { CloseIcon } from '@patternfly/react-icons';

import { getBadgeFromType } from '@console/shared';
import { AsyncComponent } from './utils/async';
import { connectToModel } from '../kinds';
import { DefaultPage } from './default-resource';
import { requirementFromString } from '../module/k8s/selector-requirement';
import { ResourceListDropdown } from './resource-dropdown';
import { resourceListPages } from './resource-pages';
import { withStartGuide } from './start-guide';
import { split, selectorFromString } from '../module/k8s/selector';
import { kindForReference, modelFor, referenceForModel } from '../module/k8s';
import { LoadingBox, MsgBox, PageHeading, ResourceIcon } from './utils';
import { SearchFilterDropdown, searchFilterValues } from './search-filter-dropdown';
import { setQueryArgument } from './utils/router';

const ResourceList = connectToModel(({ kindObj, mock, namespace, selector, nameFilter }) => {
  if (!kindObj) {
    return <LoadingBox />;
  }

  const componentLoader = resourceListPages.get(referenceForModel(kindObj), () =>
    Promise.resolve(DefaultPage),
  );
  const ns = kindObj.namespaced ? namespace : undefined;

  return (
    <AsyncComponent
      loader={componentLoader}
      namespace={ns}
      selector={selector}
      nameFilter={nameFilter}
      kind={kindObj.crd ? referenceForModel(kindObj) : kindObj.kind}
      showTitle={false}
      hideTextFilter
      autoFocus={false}
      mock={mock}
      badge={getBadgeFromType(kindObj.badge)}
    />
  );
});

const SearchPage_: React.FC<SearchProps> = (props) => {
  const [selectedItems, setSelectedItems] = React.useState(new Set<string>([]));
  const [collapsedKinds, setCollapsedKinds] = React.useState(new Set<string>([]));
  const [nameFilter, setNameFilter] = React.useState([]);
  const [labelFilter, setLabelFilter] = React.useState([]);

  const { namespace, noProjectsAvailable } = props;

  // Set state variables from the URL
  React.useEffect(() => {
    let kind: string, q: string, name: string;

    if (window.location.search) {
      const sp = new URLSearchParams(window.location.search);
      kind = sp.get('kind');
      q = sp.get('q');
      name = sp.get('name');
    }
    // Ensure that the "kind" route parameter is a valid resource kind ID
    kind = kind || '';
    if (kind !== '') {
      setSelectedItems(new Set(kind.split(',')));
    }
    const tags = split(q || '');
    const nameTags = split(name || '');
    const validTags = _.reject(tags, (tag) => requirementFromString(tag) === undefined);
    const validNameTags = _.reject(nameTags, (tag) => requirementFromString(tag) === undefined);
    setLabelFilter(validTags);
    setNameFilter(validNameTags);
  }, []);

  const updateSelectedItems = (selection: string) => {
    const updateItems = selectedItems;
    updateItems.has(selection) ? updateItems.delete(selection) : updateItems.add(selection);
    setSelectedItems(updateItems);
    setQueryArgument('kind', [...updateItems].join(','));
  };

  const clearSelectedItems = () => {
    setSelectedItems(new Set([]));
    setQueryArgument('kind', '');
  };

  const clearNameFilter = () => {
    setNameFilter([]);
    setQueryArgument('name', '');
  };

  const clearLabelFilter = () => {
    setLabelFilter([]);
    setQueryArgument('q', '');
  };

  const clearAll = () => {
    clearSelectedItems();
    clearNameFilter();
    clearLabelFilter();
  };

  const toggleKindExpanded = (kindView: string) => {
    const newCollasped = new Set(collapsedKinds);
    newCollasped.has(kindView) ? newCollasped.delete(kindView) : newCollasped.add(kindView);
    setCollapsedKinds(newCollasped);
  };

  const updateNameFilter = (value: string) => {
    setNameFilter([...nameFilter, value]);
    setQueryArgument('name', [...nameFilter, value].join(','));
  };

  const updateLabelFilter = (value: string) => {
    if (requirementFromString(value) !== undefined) {
      setLabelFilter([...labelFilter, value]);
      setQueryArgument('q', [...labelFilter, value].join(','));
    }
  };

  const updateSearchFilter = (type: string, value: string) => {
    type === searchFilterValues.Label ? updateLabelFilter(value) : updateNameFilter(value);
  };

  const removeNameFilter = (value: string) => {
    const newNames = nameFilter.filter((keepItem: string) => keepItem !== value);
    setNameFilter(newNames);
    setQueryArgument('name', newNames.join(','));
  };

  const removeLabelFilter = (value: string) => {
    const newLabels = labelFilter.filter((keepItem: string) => keepItem !== value);
    setLabelFilter(newLabels);
    setQueryArgument('q', newLabels.join(','));
  };

  const getToggleText = (item: string) => {
    const { labelPlural } = modelFor(item);
    return labelPlural;
  };

  return (
    <>
      <Helmet>
        <title>Search</title>
      </Helmet>
      <PageHeading detail={true} title="Search">
        <div className="co-search-group">
          <ResourceListDropdown
            selected={[...selectedItems]}
            onChange={updateSelectedItems}
            className="co-search-group__resource"
          />
          <SearchFilterDropdown onChange={updateSearchFilter} />
        </div>
        <div className="form-group">
          <ChipGroup withToolbar defaultIsOpen={false}>
            <ChipGroupToolbarItem key="resources-category" categoryName="Resource">
              {[...selectedItems].map((chip) => (
                <Chip key={chip} onClick={() => updateSelectedItems(chip)}>
                  <ResourceIcon kind={chip} />
                  {kindForReference(chip)}
                </Chip>
              ))}
              {selectedItems.size > 0 && (
                <span>
                  <Button variant="plain" aria-label="Close" onClick={clearSelectedItems}>
                    <CloseIcon />
                  </Button>
                </span>
              )}
            </ChipGroupToolbarItem>
            <ChipGroupToolbarItem key="label-category" categoryName={searchFilterValues.Label}>
              {labelFilter.map((chip) => (
                <Chip key={chip} onClick={() => removeLabelFilter(chip)}>
                  {chip}
                </Chip>
              ))}
              {labelFilter.length > 0 && (
                <span>
                  <Button variant="plain" aria-label="Close" onClick={clearLabelFilter}>
                    <CloseIcon />
                  </Button>
                </span>
              )}
            </ChipGroupToolbarItem>
            <ChipGroupToolbarItem key="name-category" categoryName={searchFilterValues.Name}>
              {nameFilter.map((chip) => (
                <Chip key={chip} onClick={() => removeNameFilter(chip)}>
                  {chip}
                </Chip>
              ))}
              {nameFilter.length > 0 && (
                <span>
                  <Button variant="plain" aria-label="Close" onClick={clearNameFilter}>
                    <CloseIcon />
                  </Button>
                </span>
              )}
            </ChipGroupToolbarItem>
          </ChipGroup>
          {(selectedItems.size > 0 || labelFilter.length > 0 || nameFilter.length > 0) && (
            <Button variant="link" key="clear-filters" onClick={clearAll}>
              Clear all filters
            </Button>
          )}
        </div>
      </PageHeading>
      <div className="co-search">
        <Accordion className="co-search__accordion" asDefinitionList={false} noBoxShadow>
          {[...selectedItems].map((item) => {
            const isCollapsed = collapsedKinds.has(item);
            return (
              <AccordionItem key={item}>
                <AccordionToggle
                  onClick={() => toggleKindExpanded(item)}
                  isExpanded={!isCollapsed}
                  id={`${item}-toggle`}
                >
                  {getToggleText(item)}
                </AccordionToggle>
                <AccordionContent isHidden={isCollapsed}>
                  {!isCollapsed && (
                    <ResourceList
                      kind={item}
                      selector={selectorFromString(labelFilter.join(','))}
                      nameFilter={nameFilter.join(',')}
                      namespace={namespace}
                      mock={noProjectsAvailable}
                      key={item}
                    />
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        {selectedItems.size === 0 && (
          <MsgBox
            title="No resources selected"
            detail={<p>Select one or more resources from the dropdown.</p>}
          />
        )}
      </div>
    </>
  );
};

export const SearchPage = withStartGuide(SearchPage_);

export type SearchProps = {
  location: any;
  namespace: string;
  noProjectsAvailable: boolean;
};
